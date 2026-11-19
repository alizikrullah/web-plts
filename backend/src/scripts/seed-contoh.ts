// Data contoh untuk frontend (PRD 19.3 aturan 4), di database terpisah plts_contoh dan folder file lokal,
// supaya database dan penyimpanan Directus yang asli tidak berisi data palsu.
// Pemakaian: npm run seed:contoh   (database plts_contoh dibuat ulang dari nol)
// Menjalankan backend dengan data ini: PGDATABASE=plts_contoh STORAGE_DIR=.data-contoh npm run dev
process.env.PGDATABASE = "plts_contoh"
process.env.STORAGE_DIR ??= ".data-contoh"
process.env.JWT_SECRET ??= "seed-contoh"

const { readFileSync } = await import("node:fs")
const { connect, pool } = await import("../core/db.js")
const { migrate } = await import("../core/migrate.js")
const { seedDefaults } = await import("../features/settings/settings-defaults.js")
const { insertPart, readPart } = await import("../features/parts/parts.js")
const { hashPassword } = await import("../core/tokens.js")
const { startApp, client } = await import("../test/test-db.js")

const admin0 = connect("postgres")
await admin0.query("drop database if exists plts_contoh with (force)")
await admin0.query("create database plts_contoh")
await admin0.end()
await migrate(pool)
await seedDefaults(pool)
const set = (k: string, v: unknown) => pool.query("update settings set value = $2 where key = $1", [k, JSON.stringify(v)])
await set("business_name", "[CONTOH] Usaha PLTS")
await set("whatsapp_number", "6281200000000")
await set("payment_instructions", "[CONTOH] Transfer ke rekening usaha")
await set("service_area_text", "[CONTOH] Bandung dan sekitarnya")
await set("installation_estimate", 2500000)
await set("labor_rate_per_day", 150000)
await pool.query("insert into faqs (question, answer, sort_order) values ('[CONTOH] Berapa lama pemasangan?', '[CONTOH] Jawaban ditulis tim.', 1)")
const ids: Record<string, string> = {}
for (const p of JSON.parse(readFileSync("data/parts-awal.json", "utf8"))) ids[p.category] = (await insertPart(pool, readPart(p)))!.id
ids.kabel = (await insertPart(pool, readPart({ category: "aksesoris", name: "[CONTOH] Kabel PV 10 mm", unit: "meter", unit_price: 15000 })))!.id

const PASSWORD = "contoh12345"
const person = async (name: string, email: string, role: string) => {
  await pool.query(`insert into users (name, email, whatsapp, password_hash, role, became_client_at) values ($1, $2, '6281200000001', $3, $4::varchar,
    case when $4::varchar = 'client' then now() end)`, [name, email, await hashPassword(PASSWORD), role])
  const s: any = {}
  await call("POST", "/api/auth/login", { as: s, body: { email, password: PASSWORD } })
  return s
}
const app = await startApp(), call = client(app.base)
const ok = async (r: Promise<{ status: number; json: any }>) => { const x = await r; if (x.status >= 300) throw new Error(`${x.status} ${JSON.stringify(x.json)}`); return x.json }
const admin = await person("Admin Contoh", "admin@contoh.id", "admin")
const sim = (as: any, bill: number) => ok(call("POST", "/api/simulations", { as, body: { system_type: "hybrid_offgrid", pln_power_va: 2200, monthly_bill: bill,
  usage_pattern: "seimbang", panel_part_id: ids.panel, panel_qty: 4, inverter_part_id: ids.inverter, battery_part_id: ids.baterai, battery_qty: 1 } })).then(j => j.simulation)
const submit = async (as: any, bill: number, city: string) => (await ok(call("POST", `/api/simulations/${(await sim(as, bill)).id}/submit`, { as,
  body: { address: "[CONTOH] Jl. Contoh 1", city, request_note: "[CONTOH] Atap genteng" } }))).project
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

// Guest dengan simulasi tersimpan, guest dengan pengajuan, client di tiap tahap.
await sim(await person("Guest Simulasi", "guest1@contoh.id", "guest"), 1500000)
await submit(await person("Guest Pengajuan", "guest2@contoh.id", "guest"), 2000000, "Bandung")
const steps = ["planning", "menunggu_pembayaran", "on_progress", "selesai"]
for (const [i, step] of steps.entries()) {
  const g = await person(`Client ${step}`, `client${i + 1}@contoh.id`, "guest")
  const p = await submit(g, 1000000 + i * 500000, "Cimahi")
  await ok(call("POST", `/api/admin/projects/${p.id}/accept`, { as: admin }))
  if (step === "planning") continue
  const cur = (await ok(call("GET", `/api/admin/projects/${p.id}/planning`, { as: admin }))).items
  await ok(call("PUT", `/api/admin/projects/${p.id}/planning`, { as: admin, body: { site_notes: "[CONTOH] Atap genteng", items: [
    ...cur.map((x: any) => ({ type: "part", part_id: x.part_id, qty: x.qty })), { type: "part", part_id: ids.kabel, qty: 20 },
    { type: "sdm", qty: 3, days: 2 }, { type: "jasa", description: "Instalasi dan setting inverter", unit_price: 2500000 },
    { type: "akomodasi", description: "Transport tim", unit_price: 300000 }] } }))
  await ok(call("POST", `/api/admin/projects/${p.id}/planning/finalize`, { as: admin, body: {} }))
  const inv = (await ok(call("POST", `/api/admin/projects/${p.id}/invoices`, { as: admin, body: {} }))).invoice
  if (step === "menunggu_pembayaran") continue
  await ok(call("POST", `/api/admin/invoices/${inv.id}/payments`, { as: admin, body: { amount: inv.total, paid_at: today, method: "Transfer" } }))
  await ok(call("POST", `/api/admin/projects/${p.id}/status-updates`, { as: admin, body: { note: "[CONTOH] Part sudah dipesan" } }))
  const spend = step === "selesai" ? inv.amount_parts - 150000 : Math.round(inv.amount_parts * 0.6)
  const x = (await ok(call("POST", `/api/admin/projects/${p.id}/purchases`, { as: admin, body: { document_type: "tanpa_nota", item_group: "komponen_utama",
    store_name: "[CONTOH] Toko Surya", purchase_date: today, subtotal_products: spend, total_paid: spend,
    items: [{ name: "[CONTOH] Paket komponen utama", unit: "paket", qty: 1, unit_price: spend }] } }))).purchase
  await ok(call("POST", `/api/admin/purchases/${x.id}/confirm`, { as: admin }))
  if (step !== "selesai") continue
  await ok(call("POST", `/api/admin/projects/${p.id}/refunds`, { as: admin, body: { amount: 150000, refunded_at: today, method: "Transfer" } }))
  const selesai = (await pool.query("select id from project_statuses where system_key = 'selesai'")).rows[0].id
  await ok(call("POST", `/api/admin/projects/${p.id}/status-updates`, { as: admin, body: { status_id: selesai, note: "[CONTOH] Pemasangan selesai" } }))
}
await app.close()
console.log(`Data contoh siap di database plts_contoh. Semua akun memakai password: ${PASSWORD}`)
console.log("Akun: admin@contoh.id, guest1@contoh.id, guest2@contoh.id, client1@contoh.id sampai client4@contoh.id")
await pool.end()
