import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pool } from "../../core/db.js"
import { flow } from "../../test/flow.js"
import { seedTestData, type PartKey } from "../../test/test-data.js"
import { client, freshTestDb, startApp, userSession, type Session } from "../../test/test-db.js"

let app: Awaited<ReturnType<typeof startApp>>, call: ReturnType<typeof client>, admin: Session, ids: Record<PartKey, string>, f: ReturnType<typeof flow>
beforeAll(async () => {
  await freshTestDb(); ids = await seedTestData()
  app = await startApp(); call = client(app.base); admin = await userSession(call, "admin"); f = flow(call, admin, ids)
})
afterAll(async () => { await app.close(); await pool.end() })

const plusDays = (n: number) => new Date(Date.now() + 7 * 3600e3 + n * 86400e3).toISOString().slice(0, 10)

describe("B6 skenario uji", () => {
  it("skenario 6: part dinonaktifkan, planning dan tagihan lama tetap tampil benar", async () => {
    const { project } = await f.accepted()
    await f.finalPlanning(project.id, [{ type: "part", part_id: ids.kabel, qty: 20.5, unit: "meter" }])
    const invoice = await f.issue(project.id)
    const before = (await call("GET", `/api/admin/projects/${project.id}/planning`, { as: admin })).json
    await call("PATCH", `/api/admin/parts/${ids.kabel}`, { as: admin, body: { is_active: false, unit_price: 99999 } })
    expect((await call("GET", "/api/admin/parts?active=true", { as: admin })).json.parts.map((p: any) => p.id)).not.toContain(ids.kabel)
    const after = (await call("GET", `/api/admin/projects/${project.id}/planning`, { as: admin })).json
    expect(after.items).toEqual(before.items)
    expect(after.items.find((i: any) => i.part_id === ids.kabel)).toMatchObject({ qty: 20.5, unit_price: 15000, subtotal: 307500 })
    const inv = (await call("GET", `/api/admin/projects/${project.id}/invoices`, { as: admin })).json.invoices.find((i: any) => i.id === invoice.id)
    expect(inv.items.find((i: any) => i.description === "Kabel PV 10 mm")).toMatchObject({ qty: 20.5, unit_price: 15000, subtotal: 307500 })
    // part nonaktif tidak bisa dipilih untuk planning baru
    const other = await f.accepted()
    const r = await call("PUT", `/api/admin/projects/${other.project.id}/planning`, { as: admin, body: { items: [{ type: "part", part_id: ids.kabel, qty: 1 }] } })
    expect(r.json.code).toBe("INVALID_PART")
    await call("PATCH", `/api/admin/parts/${ids.kabel}`, { as: admin, body: { is_active: true, unit_price: 15000 } })
  })
})

describe("B6 Planning", () => {
  it("subtotal dan total dihitung backend dari empat kelompok biaya, dibulatkan ke rupiah", async () => {
    const { project } = await f.accepted()
    const r = await call("PUT", `/api/admin/projects/${project.id}/planning`, { as: admin, body: { site_notes: "Atap dak", items: [
      { type: "part", part_id: ids.panel550, qty: 4, unit_price: 1650000, subtotal: 1 },
      { type: "part", part_id: ids.kabel, qty: 2.333 },
      { type: "sdm", qty: 3, days: 1.5 },
      { type: "jasa", description: "Wiring lanjutan", unit_price: 750000 },
      { type: "akomodasi", description: "Makan tim", unit_price: 200000 },
    ] } })
    expect(r.status).toBe(200)
    expect(r.json.items.map((i: any) => i.subtotal)).toEqual([6600000, Math.round(2.333 * 15000), Math.round(3 * 1.5 * 150000), 750000, 200000])
    expect(r.json.planning).toMatchObject({ total_parts: 6600000 + 34995, total_labor: 675000, total_services: 750000, total_accommodation: 200000,
      grand_total: 6600000 + 34995 + 675000 + 750000 + 200000, site_notes: "Atap dak" })
    // jasa dan akomodasi tanpa nama ditolak, SDM tanpa hari ditolak
    expect((await call("PUT", `/api/admin/projects/${project.id}/planning`, { as: admin, body: { items: [{ type: "jasa", unit_price: 1 }] } })).status).toBe(400)
    expect((await call("PUT", `/api/admin/projects/${project.id}/planning`, { as: admin, body: { items: [{ type: "sdm", qty: 2 }] } })).status).toBe(400)
  })

  it("final memakai masa berlaku harga dari Pengaturan, bisa dikembalikan ke draf sebelum tagihan terbit", async () => {
    const { project } = await f.accepted()
    expect((await call("POST", `/api/admin/projects/${project.id}/invoices`, { as: admin, body: {} })).json.code).toBe("PLANNING_DRAFT")
    const pl = await f.finalPlanning(project.id)
    expect(pl.price_valid_until).toBe(plusDays(7))
    expect((await call("PUT", `/api/admin/projects/${project.id}/planning`, { as: admin, body: { items: [] } })).json.code).toBe("PLANNING_FINAL")
    expect((await call("POST", `/api/admin/projects/${project.id}/planning/reopen`, { as: admin })).json.planning.status).toBe("draf")
    await call("POST", `/api/admin/projects/${project.id}/planning/finalize`, { as: admin, body: {} })
    await f.issue(project.id)
    expect((await call("POST", `/api/admin/projects/${project.id}/planning/reopen`, { as: admin })).json.code).toBe("PLANNING_LOCKED")
  })

  it("tarif SDM bawaan yang belum diisi tim harus diisi manual", async () => {
    const { project } = await f.accepted()
    await pool.query("update settings set value = 'null' where key = 'labor_rate_per_day'")
    expect((await call("PUT", `/api/admin/projects/${project.id}/planning`, { as: admin, body: { items: [{ type: "sdm", qty: 2, days: 1 }] } })).json.code).toBe("SETTING_NOT_FILLED")
    expect((await call("PUT", `/api/admin/projects/${project.id}/planning`, { as: admin, body: { items: [{ type: "sdm", qty: 2, days: 1, unit_price: 175000 }] } })).status).toBe(200)
    await pool.query("update settings set value = '150000' where key = 'labor_rate_per_day'")
  })
})
