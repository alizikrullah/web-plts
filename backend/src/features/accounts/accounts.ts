import { Router, type Response } from "express"
import { all, one, pool, tx, type Db } from "../../core/db.js"
import { allow, auth, cookie, fail, param, v, type Role } from "../../core/http.js"
import { appUrl, mail, sendMail } from "../../core/email.js"
import { REFRESH_TTL_SEC, checkPassword, hashPassword, hashToken, newRefreshToken, signAccess, tempPassword } from "../../core/tokens.js"

// B2: daftar, masuk, token, /me, Kelola Akun (PRD bagian 4). Daftar sendiri wajib verifikasi email dulu sebelum bisa masuk,
// dan lupa password bisa lewat email selain lewat password sementara dari admin.
export const router = Router()
const COOKIE = "refresh_token"
const LOGIN_LIMIT = 5, LOGIN_WINDOW = "15 minutes"
const PUBLIC_USER = "id, name, email, whatsapp, role, is_active, is_verified, must_change_password, became_client_at, created_at"

interface User { id: string; name: string; email: string; role: Role; must_change_password: boolean; is_active: boolean; is_verified: boolean; password_hash: string }
type Purpose = "verifikasi" | "reset_password"

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

// Token email sekali pakai. Token lama dengan tujuan yang sama langsung tidak berlaku lagi; yang disimpan hanya hash-nya.
async function emailToken(db: Db, userId: string, purpose: Purpose, ttl: string) {
  const token = newRefreshToken()
  await db.query("update email_tokens set used_at = now() where user_id = $1 and purpose = $2 and used_at is null", [userId, purpose])
  await db.query("insert into email_tokens (user_id, purpose, token_hash, expires_at) values ($1, $2, $3, now() + $4::interval)",
    [userId, purpose, hashToken(token), ttl])
  return token
}
// Kirim ulang paling cepat sekali per menit per akun, supaya tombol kirim ulang tidak bisa dipakai membanjiri email orang.
const sentRecently = async (userId: string, purpose: Purpose) =>
  !!(await one(pool, "select 1 from email_tokens where user_id = $1 and purpose = $2 and created_at > now() - interval '1 minute'", [userId, purpose]))

async function sendVerification(db: Db, user: { id: string; name: string; email: string }) {
  const token = await emailToken(db, user.id, "verifikasi", "24 hours")
  await sendMail(mail(user.email, "Verifikasi email akun PLTS Rumah", {
    preheader: "Satu langkah lagi: verifikasi email untuk mulai memakai akun PLTS Rumah.",
    title: "Verifikasi email Anda", greeting: `Halo ${user.name},`,
    paragraphs: ["Terima kasih sudah mendaftar di PLTS Rumah. Klik tombol di bawah untuk memverifikasi email Anda, lalu masuk untuk menyimpan simulasi dan mengajukan perhitungan detail."],
    button: { url: appUrl(`/verifikasi-email?token=${token}`), label: "Verifikasi email" },
    expires: "Link berlaku 24 jam.", footnote: "Kalau Anda tidak merasa mendaftar, abaikan email ini.",
  }))
}

// Register selalu membuat guest. Isian role dari form diabaikan (PRD bagian 2, aturan role 1).
// Akun belum bisa dipakai masuk sampai link verifikasi di email diklik. Kalau email gagal terkirim, akun batal dibuat.
router.post("/auth/register", async (req, res) => {
  const b = req.body ?? {}
  const name = v.str(b, "name"), email = v.email(b), whatsapp = v.whatsapp(b), pw = password(b, "password")
  if (await one(pool, "select 1 from users where email = $1", [email])) fail(409, "Email sudah terdaftar", "EMAIL_TAKEN")
  const hash = await hashPassword(pw)
  await tx(async c => {
    const user = (await one(c, "insert into users (name, email, whatsapp, password_hash) values ($1, $2, $3, $4) returning id, name, email",
      [name, email, whatsapp, hash]))!
    await sendVerification(c, user)
  })
  res.status(201).json({ email, needs_verification: true })
})

router.post("/auth/resend-verification", async (req, res) => {
  const email = v.email(req.body ?? {})
  const user = await one(pool, "select id, name, email from users where email = $1 and is_active and not is_verified", [email])
  if (user && !(await sentRecently(user.id, "verifikasi"))) await tx(c => sendVerification(c, user))
  // Jawaban selalu sama, supaya tidak bisa dipakai menebak email mana yang terdaftar.
  res.json({ ok: true })
})

router.post("/auth/verify-email", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : ""
  const row = token ? await one(pool, `select t.id, t.used_at, t.expires_at > now() fresh, u.id user_id, u.is_verified
    from email_tokens t join users u on u.id = t.user_id where t.token_hash = $1 and t.purpose = 'verifikasi'`, [hashToken(token)]) : null
  // Link yang sudah dipakai dan akunnya sudah terverifikasi tetap dijawab berhasil, misalnya kalau link diklik dua kali.
  if (!row || (row.used_at ? !row.is_verified : !row.fresh))
    fail(400, "Link verifikasi tidak berlaku atau sudah kedaluwarsa. Minta kirim ulang link verifikasi.", "INVALID_TOKEN")
  if (!row.used_at) await tx(async c => {
    await c.query("update email_tokens set used_at = now() where id = $1", [row.id])
    await c.query("update users set is_verified = true where id = $1", [row.user_id])
  })
  res.json({ ok: true })
})

router.post("/auth/forgot-password", async (req, res) => {
  const email = v.email(req.body ?? {})
  const user = await one(pool, "select id, name, email from users where email = $1 and is_active", [email])
  if (user && !(await sentRecently(user.id, "reset_password"))) await tx(async c => {
    const token = await emailToken(c, user.id, "reset_password", "1 hour")
    await sendMail(mail(user.email, "Reset password akun PLTS Rumah", {
      preheader: "Buat password baru untuk akun PLTS Rumah Anda. Link berlaku 1 jam.",
      title: "Buat password baru", greeting: `Halo ${user.name},`,
      paragraphs: ["Ada permintaan untuk mengganti password akun PLTS Rumah Anda. Klik tombol di bawah untuk membuat password baru. Setelah itu, semua perangkat yang masih masuk akan keluar otomatis."],
      button: { url: appUrl(`/reset-password?token=${token}`), label: "Buat password baru" },
      expires: "Link berlaku 1 jam dan hanya bisa dipakai sekali.", footnote: "Kalau Anda tidak meminta ini, abaikan email ini. Password lama tetap berlaku.",
    }))
  })
  res.json({ ok: true })
})

// Password baru dari link email. Semua sesi lama dicabut. Membuka link dari email juga membuktikan email itu milik user.
router.post("/auth/reset-password", async (req, res) => {
  const b = req.body ?? {}
  const token = typeof b.token === "string" ? b.token : "", next = password(b, "new_password"), hash = await hashPassword(next)
  await tx(async c => {
    const row = token ? await one(c, `update email_tokens set used_at = now()
      where token_hash = $1 and purpose = 'reset_password' and used_at is null and expires_at > now() returning user_id`, [hashToken(token)]) : null
    if (!row) fail(400, "Link reset password tidak berlaku atau sudah kedaluwarsa. Minta link baru.", "INVALID_TOKEN")
    await c.query("update users set password_hash = $2, must_change_password = false, is_verified = true where id = $1", [row.user_id, hash])
    await revokeAll(c, row.user_id)
  })
  res.json({ ok: true })
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
  if (!user!.is_verified) fail(403, "Email belum diverifikasi. Buka link verifikasi di email Anda, atau kirim ulang linknya.", "EMAIL_NOT_VERIFIED")
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
// Akun yang dibuat admin langsung terverifikasi: admin yang menerima datanya langsung dari orangnya.
export async function createAccount(db: Db, b: Record<string, unknown>, role: Role) {
  const name = v.str(b, "name"), email = v.email(b), whatsapp = v.whatsapp(b)
  if (await one(db, "select 1 from users where email = $1", [email])) fail(409, "Email sudah terdaftar", "EMAIL_TAKEN")
  const temp = tempPassword()
  const user = await one(db, `insert into users (name, email, whatsapp, password_hash, must_change_password, role, became_client_at, is_verified)
    values ($1, $2, $3, $4, true, $5::varchar, case when $5::varchar = 'client' then now() end, true) returning ${PUBLIC_USER}`,
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

// Ganti role oleh admin (keputusan tim 26 Nov 2026): guest tanpa proyek menjadi admin, admin menjadi guest.
// Client punya proyek, jadi tidak bisa menjadi admin. Admin tidak bisa mengubah role akunnya sendiri.
router.post("/admin/users/:id/role", auth, allow("admin"), async (req, res) => {
  const id = param(req, "id"), role = v.oneOf(req.body ?? {}, "role", ["admin", "guest"] as const)
  if (id === req.user!.sub) fail(400, "Tidak bisa mengubah role akun sendiri", "INVALID_INPUT")
  const user = await tx(async c => {
    const u = (await one<{ role: Role }>(c, "select role from users where id = $1 for update", [id])) ?? fail(404, "Akun tidak ditemukan", "NOT_FOUND")
    if (role === "admin") {
      if (u.role !== "guest") fail(409, u.role === "client" ? "Akun client punya proyek, jadi tidak bisa dijadikan admin" : "Akun ini sudah admin", "ROLE_NOT_ALLOWED")
      if (await one(c, "select 1 from projects where client_id = $1 limit 1", [id]))
        fail(409, "Akun ini punya pengajuan proyek, jadi tidak bisa dijadikan admin", "ROLE_NOT_ALLOWED")
    } else if (u.role !== "admin") fail(409, "Hanya admin yang bisa diturunkan menjadi guest", "ROLE_NOT_ALLOWED")
    const updated = await one(c, `update users set role = $2 where id = $1 returning ${PUBLIC_USER}`, [id, role])
    if (role === "guest") await revokeAll(c, id) // akses admin berhenti paling lama 15 menit kemudian, seperti nonaktifkan
    return updated
  })
  res.json({ user })
})

// Hapus akun (aturan 18.3, keputusan tim 26 Nov 2026): hanya akun tanpa proyek dan tanpa catatan lain.
// Simulasi dan token akun itu ikut terhapus, dan emailnya bisa dipakai daftar lagi.
router.delete("/admin/users/:id", auth, allow("admin"), async (req, res) => {
  const id = param(req, "id")
  if (id === req.user!.sub) fail(400, "Tidak bisa menghapus akun sendiri", "INVALID_INPUT")
  await tx(async c => {
    if (!(await one(c, "select 1 from users where id = $1 for update", [id]))) fail(404, "Akun tidak ditemukan", "NOT_FOUND")
    if (await one(c, "select 1 from projects where client_id = $1 limit 1", [id]))
      fail(409, "Akun ini punya proyek, jadi tidak bisa dihapus. Nonaktifkan saja.", "HAS_DATA")
    for (const t of ["simulations", "refresh_tokens", "email_tokens"]) await c.query(`delete from ${t} where user_id = $1`, [id])
    try { await c.query("delete from users where id = $1", [id]) } catch (e) {
      // Masih dirujuk data lain, misalnya penanggung jawab proyek, tagihan, pembayaran, atau perubahan Pengaturan.
      if ((e as { code?: string }).code === "23503")
        fail(409, "Akun ini sudah punya catatan di data proyek atau Pengaturan, jadi tidak bisa dihapus. Nonaktifkan saja.", "HAS_DATA")
      throw e
    }
  })
  res.json({ ok: true })
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
