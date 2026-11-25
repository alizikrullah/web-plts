import { tmpdir } from "node:os"
import { join } from "node:path"

// Backend untuk tes lewat layar (Playwright di frontend). Database plts_e2e dibangun ulang dari nol setiap kali,
// lalu diisi part dan Pengaturan contoh serta satu admin tes. Tidak pernah memanggil Groq.
// Dijalankan otomatis oleh frontend/playwright.config.ts.
process.env.PGDATABASE = "plts_e2e"
process.env.JWT_SECRET ??= "rahasia-khusus-e2e"
process.env.STORAGE_DIR ??= join(tmpdir(), "plts-e2e-file")
process.env.GROQ_API_KEY = ""
process.env.RESEND_API_KEY = "" // email tidak dikirim, dibaca tes lewat /api/__test/outbox

const { freshTestDb } = await import("./test-db.js")
const { seedTestData } = await import("./test-data.js")
const { pool } = await import("../core/db.js")
const { hashPassword } = await import("../core/tokens.js")
const { app } = await import("../app.js")
const { outbox } = await import("../core/email.js")
const express = (await import("express")).default

const { saveSimulation, simSettings } = await import("../features/simulations/simulations.js")

await freshTestDb()
await seedTestData()
await pool.query(`update settings set value = '"6281200000099"' where key = 'whatsapp_number'`)
await pool.query(`update settings set value = '"Purwakarta, Karawang, dan sekitarnya"' where key = 'service_area_text'`)
const hash = await hashPassword("password-e2e")
await pool.query("insert into users (name, email, whatsapp, password_hash, role, is_verified) values ('Admin E2E', 'admin@e2e.test', '6281200000000', $1, 'admin', true)", [hash])
// Skenario 7: guest dengan simulasi yang tegangan panelnya melebihi batas inverter (5 panel seri, Voc dingin 263 V, batas 245 V).
// Mode sederhana selalu menyusun panel dengan aman, jadi simulasi ini disiapkan langsung, seperti di tes backend.
const guest = (await pool.query("insert into users (name, email, whatsapp, password_hash, is_verified) values ('Guest Bahaya', 'bahaya@e2e.test', '6281200000001', $1, true) returning id", [hash])).rows[0]
const part = async (name: string) => (await pool.query("select * from parts where name = $1", [name])).rows[0]
await saveSimulation(pool, guest.id, { pln_power_va: 2200, monthly_bill: 1000000, usage_pattern: "seimbang", panel: await part("Panel 550 Wp"),
  panel_qty: 5, panel_series: 5, panel_parallel: 1, inverter: await part("Inverter 3000 W 24 V"), battery: await part("LiFePO4 24 V 100 Ah"), battery_qty: 1 },
  await simSettings(pool))
const port = Number(process.env.PORT ?? 3100)
// Khusus tes lewat layar: email yang "terkirim" (verifikasi dan reset password) bisa dibaca dari sini.
const server = express()
server.get("/api/__test/outbox", (_req, res) => void res.json({ mails: outbox }))
// Pengelola unduhan seperti IDM menyambar setiap respons PDF yang diterima Chrome tes dan memunculkan unduhan di komputer.
// Khusus server tes, PDF dikirim sebagai teks tanpa nama file; tes hanya memeriksa bahwa file terbuka.
server.use((_req, res, next) => {
  const set = res.setHeader.bind(res)
  res.setHeader = ((k: string, v: any) => {
    const key = k.toLowerCase()
    if (key === "content-disposition") return res
    return set(k, key === "content-type" && String(v).startsWith("application/pdf") ? "text/plain" : v)
  }) as typeof res.setHeader
  next()
})
server.use(app)
server.listen(port, () => console.log(`Backend tes lewat layar siap di port ${port}`))
