import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { one, pool } from "../../core/db.js"
import { client, freshTestDb, startApp, userSession, type Session } from "../../test/test-db.js"
import { ACCESS_TTL_SEC, verifyToken } from "../../core/tokens.js"
import { outbox } from "../../core/email.js"

let app: Awaited<ReturnType<typeof startApp>>, call: ReturnType<typeof client>
beforeAll(async () => { await freshTestDb(); app = await startApp(); call = client(app.base) })
afterAll(async () => { await app.close(); await pool.end() })

const register = (body: Record<string, unknown>, as = {}) => call("POST", "/api/auth/register", { body, as })
const person = (email: string) => ({ name: "Budi", email, whatsapp: "0812-3456-7890", password: "rahasia123" })
// Email tidak benar-benar dikirim di tes; link diambil dari outbox.
const mails = (to: string) => outbox.filter(m => m.to === to)
const tokenOf = (to: string) => mails(to).at(-1)!.text.match(/token=([\w-]+)/)![1]
const verify = (token: string) => call("POST", "/api/auth/verify-email", { body: { token } })
async function verifyAndLogin(email: string, password = "rahasia123") {
  expect((await verify(tokenOf(email))).status).toBe(200)
  const s: any = {}
  const r = await call("POST", "/api/auth/login", { as: s, body: { email, password } })
  expect(r.status).toBe(200)
  return Object.assign(s, { res: r })
}

describe("B2 skenario uji", () => {
  it("skenario 3: form daftar dengan tambahan isian role admin tetap membuat guest", async () => {
    const r = await register({ ...person("Penyusup@Tes.ID"), role: "admin" })
    expect(r.status).toBe(201)
    expect(r.json).toEqual({ email: "penyusup@tes.id", needs_verification: true })
    const s = await verifyAndLogin("penyusup@tes.id")
    expect(s.res.json.user).toMatchObject({ role: "guest", email: "penyusup@tes.id", whatsapp: "6281234567890" })
    expect(verifyToken(s.token)!.role).toBe("guest")
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
    await register(person("refresh@tes.id"))
    const s = await verifyAndLogin("refresh@tes.id")
    const setCookie = s.res.headers.get("set-cookie")!
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
    await verify(tokenOf("tebak@tes.id"))
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
    expect(r.json.user).toMatchObject({ role: "admin", must_change_password: true, is_verified: true })
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

  it("guest dijadikan admin dan admin diturunkan menjadi guest; client dan akun sendiri tidak bisa (keputusan tim 26 Nov 2026)", async () => {
    const admin = await userSession(call, "admin"), g = await userSession(call, "guest"), c = await userSession(call, "client")
    const role = (id: string, r: string, as: Session = admin) => call("POST", `/api/admin/users/${id}/role`, { as, body: { role: r } })
    const up = await role(g.id, "admin")
    expect(up.json.user.role).toBe("admin")
    // role baru terbaca saat token diperbarui, tanpa masuk ulang
    expect((await call("POST", "/api/auth/refresh", { as: g })).json.user.role).toBe("admin")
    expect((await call("GET", "/api/admin/users", { as: g })).status).toBe(200)
    expect((await role(c.id, "admin")).json.code).toBe("ROLE_NOT_ALLOWED")
    expect((await role(admin.id, "guest")).status).toBe(400)
    expect((await role(g.id, "client")).status).toBe(400)
    expect((await role(c.id, "admin", c)).status).toBe(403)
    // diturunkan: sesi dicabut, jadi akses admin berhenti paling lama saat access token habis
    expect((await role(g.id, "guest")).json.user.role).toBe("guest")
    expect((await call("POST", "/api/auth/refresh", { as: { cookie: g.cookie } })).status).toBe(401)
    expect((await role(g.id, "guest")).json.code).toBe("ROLE_NOT_ALLOWED")
  })

  it("aturan 18.3: hanya akun tanpa data yang bisa dihapus, emailnya bisa dipakai daftar lagi", async () => {
    const admin = await userSession(call, "admin"), other = await userSession(call, "admin"), g = await userSession(call, "guest")
    expect((await call("DELETE", `/api/admin/users/${admin.id}`, { as: admin })).status).toBe(400)
    expect((await call("DELETE", `/api/admin/users/${g.id}`, { as: g })).status).toBe(403)
    const del = await call("DELETE", `/api/admin/users/${g.id}`, { as: admin })
    expect(del.status).toBe(200)
    expect(await one(pool, "select 1 from users where id = $1", [g.id])).toBeUndefined()
    expect((await call("DELETE", `/api/admin/users/${g.id}`, { as: admin })).status).toBe(404)
    expect((await call("POST", "/api/auth/register", { body: { name: "Daftar Lagi", email: g.email, whatsapp: "081200000000", password: "password-baru" } })).status).toBe(201)
    // admin yang sudah mengubah Pengaturan punya catatan, jadi tidak bisa dihapus
    await call("PUT", "/api/admin/settings/sun_hours", { as: other, body: { value: 4 } })
    const kept = await call("DELETE", `/api/admin/users/${other.id}`, { as: admin })
    expect([kept.status, kept.json.code]).toEqual([409, "HAS_DATA"])
  })
})

describe("Verifikasi email dan lupa password (keputusan tim 24 Nov 2026)", () => {
  it("daftar mengirim link verifikasi; sebelum diklik tidak bisa masuk; link bisa diklik dua kali tanpa error", async () => {
    await register(person("verif1@tes.id"))
    const m = mails("verif1@tes.id").at(-1)!
    expect(m.subject).toMatch(/Verifikasi/)
    expect(m.text).toMatch(/: http:\/\/localhost:5173\/verifikasi-email\?token=[\w-]{40,}$/m)
    expect(m.html).toContain("Halo Budi")
    const before = await call("POST", "/api/auth/login", { body: { email: "verif1@tes.id", password: "rahasia123" } })
    expect(before.status).toBe(403)
    expect(before.json.code).toBe("EMAIL_NOT_VERIFIED")
    // password salah tetap dijawab salah, tidak membocorkan status verifikasi
    expect((await call("POST", "/api/auth/login", { body: { email: "verif1@tes.id", password: "salah-salah" } })).status).toBe(401)
    expect((await verify("token-ngawur")).status).toBe(400)
    const token = tokenOf("verif1@tes.id")
    expect((await verify(token)).status).toBe(200)
    expect((await verify(token)).status).toBe(200)
    const s = await verifyAndLogin("verif1@tes.id")
    expect(s.res.json.user.is_verified).toBe(true)
  })

  it("kirim ulang dibatasi sekali per menit, link lama langsung tidak berlaku, dan jawabannya sama untuk email yang tidak terdaftar", async () => {
    await register(person("verif2@tes.id"))
    const first = tokenOf("verif2@tes.id"), resend = (email: string) => call("POST", "/api/auth/resend-verification", { body: { email } })
    expect((await resend("verif2@tes.id")).status).toBe(200)
    expect(mails("verif2@tes.id")).toHaveLength(1)
    await pool.query("update email_tokens set created_at = now() - interval '2 minutes' where user_id = (select id from users where email = 'verif2@tes.id')")
    expect((await resend("verif2@tes.id")).status).toBe(200)
    expect(mails("verif2@tes.id")).toHaveLength(2)
    expect((await verify(first)).status).toBe(400)
    expect((await verify(tokenOf("verif2@tes.id"))).status).toBe(200)
    const count = outbox.length
    const unknown = await resend("tidak.ada@tes.id")
    expect(unknown.status).toBe(200)
    expect(unknown.json).toEqual({ ok: true })
    expect(outbox).toHaveLength(count)
  })

  it("link verifikasi kedaluwarsa setelah 24 jam", async () => {
    await register(person("verif3@tes.id"))
    expect((await one(pool, `select (extract(epoch from t.expires_at - t.created_at) / 3600)::int h from email_tokens t join users u on u.id = t.user_id where u.email = 'verif3@tes.id'`)).h).toBe(24)
    await pool.query("update email_tokens set expires_at = now() - interval '1 second' where user_id = (select id from users where email = 'verif3@tes.id')")
    expect((await verify(tokenOf("verif3@tes.id"))).status).toBe(400)
  })

  it("lupa password: link sekali pakai berlaku 1 jam, sesi lama dicabut, dan jawabannya sama untuk email yang tidak terdaftar", async () => {
    const c = await userSession(call, "client"), forgot = (email: string) => call("POST", "/api/auth/forgot-password", { body: { email } })
    expect((await forgot(c.email)).json).toEqual({ ok: true })
    const m = mails(c.email).at(-1)!
    expect(m.text).toMatch(/: http:\/\/localhost:5173\/reset-password\?token=[\w-]{40,}$/m)
    const token = tokenOf(c.email), reset = (body: object) => call("POST", "/api/auth/reset-password", { body })
    expect((await reset({ token, new_password: "pendek" })).status).toBe(400)
    expect((await reset({ token, new_password: "password-reset-1" })).status).toBe(200)
    expect((await reset({ token, new_password: "password-reset-2" })).status).toBe(400)
    expect((await call("POST", "/api/auth/refresh", { as: { cookie: c.cookie } })).status).toBe(401)
    expect((await call("POST", "/api/auth/login", { body: { email: c.email, password: "password-tes" } })).status).toBe(401)
    expect((await call("POST", "/api/auth/login", { body: { email: c.email, password: "password-reset-1" } })).status).toBe(200)
    // link kedaluwarsa setelah 1 jam
    await pool.query("update email_tokens set created_at = now() - interval '2 minutes' where user_id = $1", [c.id])
    await forgot(c.email)
    expect((await one(pool, "select (extract(epoch from expires_at - created_at) / 3600)::int h from email_tokens where user_id = $1 order by created_at desc limit 1", [c.id])).h).toBe(1)
    await pool.query("update email_tokens set expires_at = now() - interval '1 second' where user_id = $1", [c.id])
    expect((await reset({ token: tokenOf(c.email), new_password: "password-reset-3" })).status).toBe(400)
    const count = outbox.length
    expect((await forgot("tidak.ada@tes.id")).json).toEqual({ ok: true })
    expect(outbox).toHaveLength(count)
  })

  it("reset password lewat email ikut memverifikasi akun yang belum terverifikasi", async () => {
    await register(person("verif4@tes.id"))
    await call("POST", "/api/auth/forgot-password", { body: { email: "verif4@tes.id" } })
    expect((await call("POST", "/api/auth/reset-password", { body: { token: tokenOf("verif4@tes.id"), new_password: "password-baru-4" } })).status).toBe(200)
    expect((await call("POST", "/api/auth/login", { body: { email: "verif4@tes.id", password: "password-baru-4" } })).status).toBe(200)
  })

  it("kalau email gagal terkirim, akun batal dibuat dan pendaftar bisa mencoba lagi", async () => {
    const real = globalThis.fetch, sent: any[] = []
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((url: any, init?: any) => {
      if (!String(url).startsWith("https://api.resend.com/")) return real(url, init)
      sent.push(JSON.parse(init.body))
      return Promise.resolve(new Response("{}", { status: 500 }))
    })
    process.env.RESEND_API_KEY = "re_tes"; process.env.EMAIL_FROM = "Tim PLTS <no-reply@contoh.id>"
    try {
      const r = await register(person("gagal@tes.id"))
      expect(r.status).toBe(502)
      expect(r.json.code).toBe("EMAIL_FAILED")
      expect(sent[0]).toMatchObject({ from: "Tim PLTS <no-reply@contoh.id>", to: ["gagal@tes.id"] })
      expect(await one(pool, "select 1 from users where email = 'gagal@tes.id'")).toBeUndefined()
    } finally {
      spy.mockRestore(); process.env.RESEND_API_KEY = ""; delete process.env.EMAIL_FROM
    }
    expect((await register(person("gagal@tes.id"))).status).toBe(201)
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
