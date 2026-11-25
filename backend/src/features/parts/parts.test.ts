import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { all, one, pool } from "../../core/db.js"
import { seedDefaults } from "../settings/settings-defaults.js"
import { client, freshTestDb, startApp, userSession, type Session } from "../../test/test-db.js"

let app: Awaited<ReturnType<typeof startApp>>, call: ReturnType<typeof client>, admin: Session
beforeAll(async () => {
  await freshTestDb(); await seedDefaults(pool)
  app = await startApp(); call = client(app.base); admin = await userSession(call, "admin")
})
afterAll(async () => { await app.close(); await pool.end() })

const PANEL = { category: "panel", name: "Panel 550", unit: "unit", unit_price: 3265000, wp: 550, voc: 50.1, vmp: 42.1,
  store_name: "Toko Panel", buy_url: "https://toko.example/panel", notes: "Catatan rahasia admin" }
const INVERTER = { category: "inverter", name: "Inverter 3000", unit: "unit", unit_price: 6741800, system_type: "hybrid_offgrid",
  rated_w: 3000, pv_max_w: 2700, pv_voc_max: 245, mppt_v_min: 30, mppt_v_max: 170, efficiency_pct: 92, battery_system_v: 24, store_name: "Toko Inverter" }
const BATERAI = { category: "baterai", name: "LiFePO4 24V 100Ah", unit: "unit", unit_price: 6662100, battery_system_v: 24, capacity_ah: 100, voltage_v: 25.6, dod_pct: 90 }
const AKSESORIS = { category: "aksesoris", name: "Kabel PV 10mm", unit: "meter", unit_price: 15000, buy_url: "https://toko.example/kabel" }
const addPart = async (p: Record<string, unknown>) => {
  const r = await call("POST", "/api/admin/parts", { as: admin, body: p })
  if (r.status !== 201) throw new Error(JSON.stringify(r.json))
  return r.json.part
}

describe("B3 skenario uji", () => {
  it("skenario 19: pengunjung tanpa login tidak menerima toko, link beli, catatan part, dan cara pembayaran", async () => {
    await addPart(PANEL); await addPart(INVERTER); await addPart(BATERAI); await addPart(AKSESORIS)
    await call("PUT", "/api/admin/settings/payment_instructions", { as: admin, body: { value: "Transfer ke rekening 123" } })
    await call("PUT", "/api/admin/settings/whatsapp_number", { as: admin, body: { value: "6281234567890" } })

    const parts = await call("GET", "/api/parts")
    expect(parts.status).toBe(200)
    expect(parts.json.parts.map((p: any) => p.name).sort()).toEqual(["Inverter 3000", "LiFePO4 24V 100Ah", "Panel 550"])
    const text = JSON.stringify(parts.json)
    for (const secret of ["store_name", "buy_url", "notes", "Toko Panel", "toko.example", "Catatan rahasia"]) expect(text).not.toContain(secret)
    expect(parts.json.parts.find((p: any) => p.category === "panel")).toMatchObject({ unit_price: 3265000, wp: 550, voc: 50.1, vmp: 42.1 })

    const s = await call("GET", "/api/settings/public")
    expect(s.status).toBe(200)
    const st = JSON.stringify(s.json)
    expect(st).not.toContain("payment_instructions")
    expect(st).not.toContain("Transfer ke rekening")
    for (const hidden of ["price_validity_days", "invoice_due_days", "labor_rate_per_day", "action_thresholds", "business_name"])
      expect(s.json.settings[hidden], hidden).toBeUndefined()
    expect(s.json.settings).toMatchObject({ whatsapp_number: "6281234567890", sun_hours: 4, day_share_pct: { sepi_siang: 25, seimbang: 40, ramai_siang: 55 } })
  })

  it("skenario 6: part dinonaktifkan hilang dari pilihan, data lama yang memakainya tetap utuh", async () => {
    const panel = await addPart({ ...PANEL, name: "Panel lama" })
    const inv = (await all(pool, "select id from parts where name = 'Inverter 3000'"))[0]
    // simulasi dan planning lama menyalin harga saat dibuat
    const user = (await one(pool, "select id from users where role = 'admin' limit 1"))!
    const sim = await one(pool, `insert into simulations (user_id, system_type, panel_part_id, panel_qty, panel_series, panel_parallel, inverter_part_id,
      pln_power_va, monthly_bill, usage_pattern, day_load_kw, night_load_kw, params, snapshot, est_investment, capacity_kwp, daily_production_kwh,
      daily_saved_kwh, monthly_saving, net_profit, bep_years, is_locked) values ($1, 'hybrid_offgrid', $2, 4, 4, 1, $3, 2200, 1000000, 'seimbang',
      0.5, 0.2, '{}', $4, 30000000, 2.2, 7.5, 6, 270000, 50000000, 8.6, true) returning id`,
      [user.id, panel.id, inv.id, JSON.stringify({ panel: { name: "Panel lama", unit_price: 3265000 } })])

    const off = await call("PATCH", `/api/admin/parts/${panel.id}`, { as: admin, body: { is_active: false, unit_price: 4000000 } })
    expect(off.status).toBe(200)
    expect((await call("GET", "/api/parts")).json.parts.map((p: any) => p.id)).not.toContain(panel.id)
    expect((await call("GET", "/api/admin/parts?active=false", { as: admin })).json.parts.map((p: any) => p.id)).toContain(panel.id)
    const after = await one(pool, "select snapshot, est_investment, monthly_saving, panel_part_id from simulations where id = $1", [sim!.id])
    expect(after).toMatchObject({ snapshot: { panel: { name: "Panel lama", unit_price: 3265000 } }, est_investment: 30000000, monthly_saving: 270000, panel_part_id: panel.id })
  })
})

describe("B3 List Part", () => {
  it("kolom teknis wajib sesuai kategori dan dikosongkan untuk kategori lain", async () => {
    const bad = (p: Record<string, unknown>) => call("POST", "/api/admin/parts", { as: admin, body: p }).then(r => r.status)
    expect(await bad({ ...PANEL, voc: undefined })).toBe(400)
    expect(await bad({ ...INVERTER, battery_system_v: 36 })).toBe(400)
    expect(await bad({ ...INVERTER, mppt_v_min: 200 })).toBe(400)
    expect(await bad({ ...BATERAI, dod_pct: 0 })).toBe(400)
    expect(await bad({ ...PANEL, unit_price: 1500.5 })).toBe(400)
    // isian teknis kategori lain diabaikan dan disimpan kosong
    const p = await addPart({ ...AKSESORIS, name: "Kabel isian teknis", wp: 550 })
    expect(p.wp).toBeNull()
    // inverter on-grid tidak memakai baterai
    const og = await addPart({ ...INVERTER, name: "Inverter on-grid", system_type: "on_grid", battery_system_v: null })
    expect(og.battery_system_v).toBeNull()
  })

  it("tahap lanjutan: kelas paket, Isc, arus input, jumlah siklus, dan aturan jumlah aksesoris (PRD 11.1)", async () => {
    const bad = (p: Record<string, unknown>) => call("POST", "/api/admin/parts", { as: admin, body: p }).then(r => r.status)
    const panel = await addPart({ ...PANEL, name: "Panel kelas", package_tier: "premium", isc: 13.9 })
    expect(panel).toMatchObject({ package_tier: "premium", isc: 13.9 })
    expect((await addPart({ ...INVERTER, name: "Inverter arus", pv_current_max: 18 })).pv_current_max).toBe(18)
    expect((await addPart({ ...BATERAI, name: "Baterai siklus", cycle_life: 6000 })).cycle_life).toBe(6000)
    expect(await bad({ ...PANEL, package_tier: "mewah" })).toBe(400)
    expect(await bad({ ...BATERAI, cycle_life: 0 })).toBe(400)
    expect(await bad({ ...AKSESORIS, qty_basis: "per_panel" })).toBe(400) // jumlah per dasar wajib kalau dasar diisi
    // aksesoris dengan aturan jumlah ikut terkirim ke Simulator; kelas paket tidak berlaku untuk aksesoris
    const rail = await addPart({ ...AKSESORIS, name: "Rail uji", unit: "meter", system_type: "on_grid", qty_basis: "per_panel", qty_per_basis: 1.4, package_tier: "hemat" })
    expect(rail).toMatchObject({ system_type: "on_grid", qty_basis: "per_panel", qty_per_basis: 1.4, package_tier: null })
    const pub = (await call("GET", "/api/parts")).json.parts
    expect(pub.find((p: any) => p.id === rail.id)).toMatchObject({ unit: "meter", qty_basis: "per_panel", qty_per_basis: 1.4 })
    expect(pub.find((p: any) => p.id === panel.id)).toMatchObject({ package_tier: "premium", isc: 13.9 })
    // aturan jumlah bisa dihapus lagi: aksesoris kembali hanya untuk Planning
    const off = await call("PATCH", `/api/admin/parts/${rail.id}`, { as: admin, body: { qty_basis: null, system_type: null } })
    expect(off.json.part).toMatchObject({ qty_basis: null, qty_per_basis: null, system_type: null })
    expect((await call("GET", "/api/parts")).json.parts.map((p: any) => p.id)).not.toContain(rail.id)
    // database ikut menjaga: kolom tambahan tidak boleh diisi untuk kategori lain
    await expect(pool.query("update parts set cycle_life = 100 where id = $1", [panel.id])).rejects.toThrow(/parts_kolom_tambahan/)
    await expect(pool.query("update parts set system_type = 'on_grid' where id = $1", [panel.id])).rejects.toThrow(/parts_jenis_sistem/)
  })

  it("mengubah harga memperbarui tanggal harga, kategori tidak bisa diganti", async () => {
    const p = await addPart({ ...PANEL, name: "Panel harga" })
    await pool.query("update parts set price_updated_at = now() - interval '40 days' where id = $1", [p.id])
    const r = await call("PATCH", `/api/admin/parts/${p.id}`, { as: admin, body: { name: "Panel harga baru" } })
    expect(Date.now() - Date.parse(r.json.part.price_updated_at)).toBeGreaterThan(39 * 86400e3)
    const r2 = await call("PATCH", `/api/admin/parts/${p.id}`, { as: admin, body: { unit_price: 3300000 } })
    expect(Date.now() - Date.parse(r2.json.part.price_updated_at)).toBeLessThan(60e3)
    expect((await call("PATCH", `/api/admin/parts/${p.id}`, { as: admin, body: { category: "aksesoris" } })).status).toBe(400)
  })

  it("hanya admin yang bisa melihat semua kolom dan mengubah part", async () => {
    const c = await userSession(call, "client")
    expect((await call("GET", "/api/admin/parts", { as: c })).status).toBe(403)
    expect((await call("POST", "/api/admin/parts", { as: c, body: PANEL })).status).toBe(403)
    const list = await call("GET", "/api/admin/parts?category=panel", { as: admin })
    expect(list.json.parts.every((p: any) => p.category === "panel" && "store_name" in p)).toBe(true)
  })
})

it("aturan 18.3: users, parts, project_statuses, dan project_sub_statuses tidak bisa dihapus permanen", async () => {
  for (const t of ["users", "parts", "project_statuses", "project_sub_statuses"])
    await expect(pool.query(`delete from ${t} where id = (select id from ${t} limit 1)`), t).rejects.toThrow(/tidak boleh dihapus/)
  // faqs tidak termasuk aturan ini
  await expect(pool.query("delete from faqs")).resolves.toBeTruthy()
})
