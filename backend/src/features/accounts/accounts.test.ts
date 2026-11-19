import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { one, pool } from "../../core/db.js"
import { client, freshTestDb, startApp, userSession } from "../../test/test-db.js"
import { ACCESS_TTL_SEC, verifyToken } from "../../core/tokens.js"

let app: Awaited<ReturnType<typeof startApp>>, call: ReturnType<typeof client>
beforeAll(async () => { await freshTestDb(); app = await startApp(); call = client(app.base) })
afterAll(async () => { await app.close(); await pool.end() })

const register = (body: Record<string, unknown>, as = {}) => call("POST", "/api/auth/register", { body, as })
const person = (email: string) => ({ name: "Budi", email, whatsapp: "0812-3456-7890", password: "rahasia123" })

describe("B2 skenario uji", () => {
  it("skenario 3: form daftar dengan tambahan isian role admin tetap membuat guest", async () => {
    const s = {}
    const r = await register({ ...person("Penyusup@Tes.ID"), role: "admin" }, s)
    expect(r.status).toBe(201)
    expect(r.json.user.role).toBe("guest")
    expect(r.json.user.email).toBe("penyusup@tes.id")
    expect(r.json.user.whatsapp).toBe("6281234567890")
    expect(verifyToken(r.json.access_token)!.role).toBe("guest")
    expect((await one(pool, "select role from users where email = 'penyusup@tes.id'")).role).toBe("guest")
    expect((await call("GET", "/api/admin/users", { as: s })).status).toBe(403)
  })

  it("skenario 2: guest ditolak saat membuka Status Pengerjaan atau Invoice Pembelian", async () => {
    const guest = await userSession(call, "guest")
    for (const path of ["/api/projects", "/api/projects/00000000-0000-0000-0000-000000000000/status", "/api/projects/00000000-0000-0000-0000-000000000000/purchases"]) {
      const r = await call("GET", path, { as: guest })
      expect(r.status, path).toBe(403)
      expect(r.json.code).toBe("FORBIDDEN")
      expect((await call("GET", path)).status, `${path} tanpa login`).toBe(401)
    }
  })

  it("skenario 14: akun client dinonaktifkan, akses berhenti paling lama 15 menit kemudian", async () => {
    const admin = await userSession(call, "admin"), c = await userSession(call, "client")
    expect(verifyToken(c.token!)!.exp - Date.now() / 1000).toBeLessThanOrEqual(ACCESS_TTL_SEC)
    const r = await call("PATCH", `/api/admin/users/${c.id}`, { as: admin, body: { is_active: false } })
    expect(r.status).toBe(200)
    expect(r.json.user.is_active).toBe(false)
    // refresh token sudah dicabut, jadi access token baru tidak bisa didapat lagi
    expect((await call("POST", "/api/auth/refresh", { as: { cookie: c.cookie } })).status).toBe(401)
    expect((await call("POST", "/api/auth/login", { body: { email: c.email, password: "password-tes" } })).status).toBe(403)
    // diaktifkan lagi: bisa masuk lagi
    await call("PATCH", `/api/admin/users/${c.id}`, { as: admin, body: { is_active: true } })
    expect((await call("POST", "/api/auth/login", { body: { email: c.email, password: "password-tes" } })).status).toBe(200)
  })
})

describe("B2 akun dan token", () => {
  it("tiga role bisa masuk dan /me mengembalikan data dari database", async () => {
    for (const role of ["guest", "client", "admin"] as const) {
      const s = await userSession(call, role)
      const r = await call("GET", "/api/me", { as: s })
      expect(r.status).toBe(200)
      expect(r.json.user.role).toBe(role)
      expect(r.json.user.password_hash).toBeUndefined()
    }
  })

  it("refresh token di cookie httpOnly, dipakai sekali lalu diganti, dan role diambil dari database", async () => {
    const s: any = {}
    const r = await register(person("refresh@tes.id"), s)
    const setCookie = r.headers.get("set-cookie")!
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/Path=\/api\/auth/)
    const old = s.cookie
    await pool.query("update users set role = 'client' where email = 'refresh@tes.id'")
    const r2 = await call("POST", "/api/auth/refresh", { as: s })
    expect(r2.status).toBe(200)
    expect(verifyToken(r2.json.access_token)!.role).toBe("client")
    expect(s.cookie).not.toBe(old)
    expect((await call("POST", "/api/auth/refresh", { as: { cookie: old } })).status).toBe(401)
  })

  it("keluar mencabut refresh token", async () => {
    const s = await userSession(call, "guest"), cookie = s.cookie
    expect((await call("POST", "/api/auth/logout", { as: s })).status).toBe(200)
    expect((await call("POST", "/api/auth/refresh", { as: { cookie } })).status).toBe(401)
  })

  it("masuk yang gagal dibatasi 5 kali per 15 menit per email", async () => {
    await register(person("tebak@tes.id"))
    for (let i = 0; i < 5; i++)
      expect((await call("POST", "/api/auth/login", { body: { email: "tebak@tes.id", password: "salah-salah" } })).status).toBe(401)
    const blocked = await call("POST", "/api/auth/login", { body: { email: "tebak@tes.id", password: "rahasia123" } })
    expect(blocked.status).toBe(429)
    // email lain tidak ikut terblokir
    expect((await call("POST", "/api/auth/login", { body: { email: "refresh@tes.id", password: "rahasia123" } })).status).toBe(200)
    // setelah 15 menit lewat, boleh mencoba lagi
    await pool.query("update login_attempts set attempted_at = now() - interval '16 minutes' where email = 'tebak@tes.id'")
    expect((await call("POST", "/api/auth/login", { body: { email: "tebak@tes.id", password: "rahasia123" } })).status).toBe(200)
  })

  it("daftar menolak email ganda dan isian yang tidak valid", async () => {
    expect((await register(person("ganda@tes.id"))).status).toBe(201)
    expect((await register(person("GANDA@tes.id"))).status).toBe(409)
    expect((await register({ ...person("a@tes.id"), whatsapp: "" })).status).toBe(400)
    expect((await register({ ...person("b@tes.id"), password: "pendek" })).status).toBe(400)
    expect((await register({ ...person("bukan-email"), })).status).toBe(400)
  })

  it("ubah nama, nomor WhatsApp, dan password sendiri", async () => {
    const s = await userSession(call, "client")
    const r = await call("PATCH", "/api/me", { as: s, body: { name: "Nama Baru", whatsapp: "+62 811 1111 2222" } })
    expect(r.json.user).toMatchObject({ name: "Nama Baru", whatsapp: "6281111112222" })
    expect((await call("POST", "/api/me/password", { as: s, body: { current_password: "salah", new_password: "password-baru" } })).status).toBe(400)
    expect((await call("POST", "/api/me/password", { as: s, body: { current_password: "password-tes", new_password: "password-baru" } })).status).toBe(200)
    expect((await call("POST", "/api/auth/login", { body: { email: s.email, password: "password-baru" } })).status).toBe(200)
  })
})

describe("B2 Kelola Akun", () => {
  it("admin membuat akun admin baru dengan password sementara yang wajib diganti", async () => {
    const admin = await userSession(call, "admin")
    const r = await call("POST", "/api/admin/users", { as: admin, body: { name: "Admin Dua", email: "admin.dua@tes.id", whatsapp: "08129999999" } })
    expect(r.status).toBe(201)
    expect(r.json.user).toMatchObject({ role: "admin", must_change_password: true })
    const s: any = {}
    const login = await call("POST", "/api/auth/login", { as: s, body: { email: "admin.dua@tes.id", password: r.json.temporary_password } })
    expect(login.status).toBe(200)
    // sebelum ganti password, endpoint lain ditolak
    const blocked = await call("GET", "/api/admin/users", { as: s })
    expect(blocked.status).toBe(403)
    expect(blocked.json.code).toBe("MUST_CHANGE_PASSWORD")
    expect((await call("GET", "/api/me", { as: s })).status).toBe(200)
    expect((await call("POST", "/api/me/password", { as: s, body: { current_password: r.json.temporary_password, new_password: "password-admin-2" } })).status).toBe(200)
    expect((await call("GET", "/api/admin/users", { as: s })).status).toBe(200)
  })

  it("password sementara untuk user yang lupa password mencabut sesi lamanya", async () => {
    const admin = await userSession(call, "admin"), c = await userSession(call, "client")
    const r = await call("POST", `/api/admin/users/${c.id}/temp-password`, { as: admin })
    expect(r.status).toBe(200)
    expect((await call("POST", "/api/auth/refresh", { as: { cookie: c.cookie } })).status).toBe(401)
    expect((await call("POST", "/api/auth/login", { body: { email: c.email, password: "password-tes" } })).status).toBe(401)
    const login = await call("POST", "/api/auth/login", { body: { email: c.email, password: r.json.temporary_password } })
    expect(login.json.user.must_change_password).toBe(true)
  })

  it("daftar akun bisa dicari dan hanya untuk admin", async () => {
    const admin = await userSession(call, "admin"), c = await userSession(call, "client")
    const r = await call("GET", "/api/admin/users?q=ganda", { as: admin })
    expect(r.json.users.map((u: any) => u.email)).toEqual(["ganda@tes.id"])
    expect((await call("GET", "/api/admin/users", { as: c })).status).toBe(403)
    expect((await call("GET", "/api/admin/users")).status).toBe(401)
    expect((await call("PATCH", `/api/admin/users/${admin.id}`, { as: admin, body: { is_active: false } })).status).toBe(400)
  })

  it("aturan 18.3: tidak ada endpoint hapus akun", async () => {
    const admin = await userSession(call, "admin"), c = await userSession(call, "client")
    expect((await call("DELETE", `/api/admin/users/${c.id}`, { as: admin })).status).toBe(404)
  })
})

it("CORS hanya untuk alamat frontend yang terdaftar, dengan cookie", async () => {
  const ok = await call("OPTIONS", "/api/auth/login", { headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" } })
  expect(ok.status).toBe(204)
  expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173")
  expect(ok.headers.get("access-control-allow-credentials")).toBe("true")
  const other = await call("GET", "/api/health", { headers: { origin: "http://jahat.example" } })
  expect(other.headers.get("access-control-allow-origin")).toBeNull()
})
