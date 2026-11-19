import { Router, type Response } from "express"
import { all, one, pool, tx, type Db } from "../../core/db.js"
import { allow, auth, cookie, fail, param, v, type Role } from "../../core/http.js"
import { REFRESH_TTL_SEC, checkPassword, hashPassword, hashToken, newRefreshToken, signAccess, tempPassword } from "../../core/tokens.js"

// B2: daftar, masuk, token, /me, Kelola Akun (PRD bagian 4).
export const router = Router()
const COOKIE = "refresh_token"
const LOGIN_LIMIT = 5, LOGIN_WINDOW = "15 minutes"
const PUBLIC_USER = "id, name, email, whatsapp, role, is_active, must_change_password, became_client_at, created_at"

interface User { id: string; role: Role; must_change_password: boolean; is_active: boolean; password_hash: string }

const password = (b: Record<string, unknown>, k: string) => {
  const pw = b[k]
  if (typeof pw !== "string" || pw.length < 8) return fail(400, `${k} minimal 8 karakter`, "INVALID_INPUT")
  if (pw.length > 200) return fail(400, `${k} terlalu panjang`, "INVALID_INPUT")
  return pw
}

// Access token dikirim di isi jawaban; refresh token di cookie httpOnly yang tidak bisa dibaca JavaScript.
async function startSession(res: Response, user: User) {
  const token = newRefreshToken()
  await pool.query("insert into refresh_tokens (user_id, token_hash, expires_at) values ($1, $2, now() + $3 * interval '1 second')",
    [user.id, hashToken(token), REFRESH_TTL_SEC])
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${REFRESH_TTL_SEC}`)
  return signAccess(user)
}
const clearCookie = (res: Response) => res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0`)
export const revokeAll = (db: Db, userId: string) =>
  db.query("update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null", [userId])

// Register selalu membuat guest. Isian role dari form diabaikan (PRD bagian 2, aturan role 1).
router.post("/auth/register", async (req, res) => {
  const b = req.body ?? {}
  const name = v.str(b, "name"), email = v.email(b), whatsapp = v.whatsapp(b), pw = password(b, "password")
  if (await one(pool, "select 1 from users where email = $1", [email])) fail(409, "Email sudah terdaftar", "EMAIL_TAKEN")
  const user = (await one<User>(pool, `insert into users (name, email, whatsapp, password_hash) values ($1, $2, $3, $4) returning *`,
    [name, email, whatsapp, await hashPassword(pw)]))!
  res.status(201).json({ access_token: await startSession(res, user), user: await me(user.id) })
})

router.post("/auth/login", async (req, res) => {
  const b = req.body ?? {}
  const email = v.email(b), pw = typeof b.password === "string" ? b.password : ""
  const recent = await one(pool, `select count(*)::int n from login_attempts where email = $1 and attempted_at > now() - interval '${LOGIN_WINDOW}'`, [email])
  if (recent.n >= LOGIN_LIMIT) fail(429, "Terlalu banyak percobaan masuk. Coba lagi 15 menit lagi.", "TOO_MANY_ATTEMPTS")
  const user = await one<User>(pool, "select * from users where email = $1", [email])
  if (!user || !(await checkPassword(pw, user.password_hash))) {
    await pool.query(`delete from login_attempts where attempted_at < now() - interval '${LOGIN_WINDOW}'`)
    await pool.query("insert into login_attempts (email) values ($1)", [email])
    fail(401, "Email atau password salah", "BAD_CREDENTIALS")
  }
  if (!user!.is_active) fail(403, "Akun dinonaktifkan. Hubungi admin.", "INACTIVE")
  res.json({ access_token: await startSession(res, user!), user: await me(user!.id) })
})

// Refresh token dipakai sekali lalu diganti yang baru. Role di access token baru diambil dari database,
// jadi guest yang baru diterima langsung menjadi client tanpa login ulang (PRD bagian 4).
router.post("/auth/refresh", async (req, res) => {
  const token = cookie(req, COOKIE)
  const row = token && await one(pool, `update refresh_tokens set revoked_at = now()
    where token_hash = $1 and revoked_at is null and expires_at > now() returning user_id`, [hashToken(token)])
  const user = row && await one<User>(pool, "select * from users where id = $1 and is_active", [row.user_id])
  if (!user) { clearCookie(res); fail(401, "Sesi berakhir, silakan masuk lagi", "UNAUTHENTICATED") }
  res.json({ access_token: await startSession(res, user!), user: await me(user!.id) })
})

router.post("/auth/logout", async (req, res) => {
  const token = cookie(req, COOKIE)
  if (token) await pool.query("update refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null", [hashToken(token)])
  clearCookie(res)
  res.json({ ok: true })
})

const me = (id: string) => one(pool, `select ${PUBLIC_USER} from users where id = $1`, [id])

router.get("/me", auth, async (req, res) => {
  const user = await me(req.user!.sub)
  if (!user) fail(401, "Akun tidak ditemukan", "UNAUTHENTICATED")
  res.json({ user })
})

router.patch("/me", auth, async (req, res) => {
  const b = req.body ?? {}
  const user = await one(pool, `update users set name = $2, whatsapp = $3 where id = $1 returning ${PUBLIC_USER}`,
    [req.user!.sub, v.str(b, "name"), v.whatsapp(b)])
  res.json({ user })
})

router.post("/me/password", auth, async (req, res) => {
  const b = req.body ?? {}
  const current = typeof b.current_password === "string" ? b.current_password : "", next = password(b, "new_password")
  const user = (await one<User>(pool, "select * from users where id = $1", [req.user!.sub]))!
  if (!(await checkPassword(current, user.password_hash))) fail(400, "Password lama salah", "BAD_CREDENTIALS")
  if (current === next) fail(400, "Password baru harus berbeda", "INVALID_INPUT")
  const updated = (await one<User>(pool, "update users set password_hash = $2, must_change_password = false where id = $1 returning *",
    [user.id, await hashPassword(next)]))!
  res.json({ access_token: signAccess(updated), user: await me(user.id) })
})

// Kelola Akun, hanya admin (PRD bagian 4).
router.get("/admin/users", auth, allow("admin"), async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : ""
  const users = await all(pool, `select ${PUBLIC_USER} from users
    where $1 = '' or name ilike '%' || $1 || '%' or email ilike '%' || $1 || '%' or whatsapp like '%' || $1 || '%'
    order by created_at desc limit 500`, [q])
  res.json({ users })
})

// Membuat akun dengan password sementara yang wajib diganti saat masuk berikutnya.
export async function createAccount(db: Db, b: Record<string, unknown>, role: Role) {
  const name = v.str(b, "name"), email = v.email(b), whatsapp = v.whatsapp(b)
  if (await one(db, "select 1 from users where email = $1", [email])) fail(409, "Email sudah terdaftar", "EMAIL_TAKEN")
  const temp = tempPassword()
  const user = await one(db, `insert into users (name, email, whatsapp, password_hash, must_change_password, role, became_client_at)
    values ($1, $2, $3, $4, true, $5::varchar, case when $5::varchar = 'client' then now() end) returning ${PUBLIC_USER}`,
    [name, email, whatsapp, await hashPassword(temp), role])
  return { user, temporary_password: temp }
}

router.post("/admin/users", auth, allow("admin"), async (req, res) => {
  res.status(201).json(await createAccount(pool, req.body ?? {}, "admin"))
})

router.patch("/admin/users/:id", auth, allow("admin"), async (req, res) => {
  const id = param(req, "id"), active = v.bool(req.body ?? {}, "is_active")
  if (id === req.user!.sub && !active) fail(400, "Tidak bisa menonaktifkan akun sendiri", "INVALID_INPUT")
  const user = await tx(async c => {
    const u = await one(c, `update users set is_active = $2 where id = $1 returning ${PUBLIC_USER}`, [id, active])
    if (!u) fail(404, "Akun tidak ditemukan", "NOT_FOUND")
    if (!active) await revokeAll(c, id) // akses berhenti paling lama 15 menit kemudian
    return u
  })
  res.json({ user })
})

router.post("/admin/users/:id/temp-password", auth, allow("admin"), async (req, res) => {
  const id = param(req, "id"), temp = tempPassword()
  const user = await tx(async c => {
    const u = await one(c, `update users set password_hash = $2, must_change_password = true where id = $1 returning ${PUBLIC_USER}`,
      [id, await hashPassword(temp)])
    if (!u) fail(404, "Akun tidak ditemukan", "NOT_FOUND")
    await revokeAll(c, id)
    return u
  })
  res.json({ user, temporary_password: temp })
})
