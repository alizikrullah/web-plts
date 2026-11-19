import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Params } from "../../../../shared/calc/rumah.js"
import { arrangements, evaluate, recommend, toParams, type Battery, type Inverter, type Panel } from "../../../../shared/calc/simulator.js"
import { all, pool } from "../../core/db.js"
import { simSettings } from "./simulations.js"
import { legacy, seedTestData, type PartKey } from "../../test/test-data.js"
import { client, freshTestDb, startApp, userSession, type Session } from "../../test/test-db.js"

let app: Awaited<ReturnType<typeof startApp>>, call: ReturnType<typeof client>, guest: Session, admin: Session, ids: Record<PartKey, string>
beforeAll(async () => {
  await freshTestDb(); ids = await seedTestData()
  app = await startApp(); call = client(app.base)
  guest = await userSession(call, "guest"); admin = await userSession(call, "admin")
})
afterAll(async () => { await app.close(); await pool.end() })

const save = (body: Record<string, unknown>, as: Session = guest) => call("POST", "/api/simulations", { as, body })
const simple = (o: Record<string, unknown> = {}) => ({ system_type: "hybrid_offgrid", pln_power_va: 2200, monthly_bill: 1000000, usage_pattern: "seimbang",
  panel_part_id: ids.panel550, panel_qty: 4, inverter_part_id: ids.inv3000, battery_part_id: ids.bat24, battery_qty: 1, ...o })
const partsByCategory = async () => {
  const rows = await all(pool, "select * from parts where is_active")
  return { panels: rows.filter(r => r.category === "panel") as Panel[], inverters: rows.filter(r => r.category === "inverter") as Inverter[],
    batteries: rows.filter(r => r.category === "baterai") as Battery[] }
}

describe("B4 skenario uji", () => {
  it("skenario 15: isian yang sama di simulator HTML lama dan modul baru memberi hemat, BEP, dan aliran energi yang sama", async () => {
    const cases = [simple(), simple({ battery_part_id: null, battery_qty: 0 }), simple({ usage_pattern: "ramai_siang", monthly_bill: 3500000, panel_qty: 3 }),
      simple({ usage_pattern: "sepi_siang", monthly_bill: 300000, panel_qty: 2, pln_power_va: 900 }), simple({ battery_qty: 2, panel_part_id: ids.panel450, panel_qty: 6 })]
    for (const body of cases) {
      const r = await save(body)
      expect(r.status, JSON.stringify(r.json)).toBe(201)
      const s = r.json.simulation, old = legacy(s.params as Params), now = evaluate(s.params as Params)
      expect(s.monthly_saving).toBe(Math.round(old.fin.month))
      expect(s.bep_years).toBe(old.fin.bep)
      expect(s.net_profit).toBe(Math.round(old.fin.net))
      expect(s.est_investment).toBe(Math.round(old.inv))
      expect(s.daily_saved_kwh).toBe(old.sim.saved)
      expect(s.daily_production_kwh).toBe(old.sim.dcDay)
      const flow = ({ pvDirect, bat, grid, waste, clip, loadE, charged, prof }: any) => ({ pvDirect, bat, grid, waste, clip, loadE, charged, prof })
      expect(flow(now.sim)).toEqual(flow(old.sim))
    }
  })

  it("skenario 16: hemat per bulan di mode sederhana tidak pernah melebihi tagihan", async () => {
    const s = await simSettings(pool), parts = await partsByCategory()
    let checked = 0
    for (const inverter of parts.inverters.filter(i => i.system_type === "hybrid_offgrid"))
      for (const panel of parts.panels)
        for (const a of arrangements(panel, inverter))
          for (const battery of [null, ...parts.batteries.filter(b => b.battery_system_v === inverter.battery_system_v)])
            for (const usage_pattern of ["sepi_siang", "seimbang", "ramai_siang"] as const)
              for (const monthly_bill of [50000, 150000, 400000, 1000000, 2500000, 6000000])
                for (const pln_power_va of [900, 2200, 6600]) {
                  const p = toParams({ pln_power_va, monthly_bill, usage_pattern, panel, panel_qty: a.qty, panel_series: a.series,
                    panel_parallel: a.parallel, inverter, battery, battery_qty: battery ? 1 : 0 }, s)
                  expect(evaluate(p).result.monthly_saving, JSON.stringify({ panel: panel.name, a, monthly_bill, usage_pattern })).toBeLessThanOrEqual(monthly_bill)
                  checked++
                }
    expect(checked).toBeGreaterThan(1000)
    // juga lewat API: sistem besar dengan tagihan kecil
    const r = await save(simple({ monthly_bill: 100000, panel_qty: 4, battery_qty: 2 }))
    expect(r.json.simulation.monthly_saving).toBeLessThanOrEqual(100000)
  })

  it("skenario 17: daya PLN 2200 VA mendapat inverter 3000 W, jumlah panel yang balik modalnya tercepat", async () => {
    const s = await simSettings(pool), parts = await partsByCategory()
    const rec = recommend(parts, s, { pln_power_va: 2200, monthly_bill: 1000000, usage_pattern: "seimbang" })!
    expect(rec.inverter.id).toBe(ids.inv3000)
    expect(rec.inverter_too_small).toBe(false)
    // hitung sendiri semua pasangan panel dan jumlah yang valid, lalu cari BEP tercepat
    let bestBep = Infinity
    for (const panel of parts.panels) for (const a of arrangements(panel, rec.inverter)) {
      const bep = evaluate(toParams({ pln_power_va: 2200, monthly_bill: 1000000, usage_pattern: "seimbang", panel, panel_qty: a.qty, panel_series: a.series,
        panel_parallel: a.parallel, inverter: rec.inverter, battery: rec.battery, battery_qty: 1 }, s)).result.bep_years
      if (bep !== null && bep < bestBep) bestBep = bep
    }
    expect(rec.choice.bep_years).toBe(bestBep)
    // tabel pembanding: jumlah panel lebih sedikit dan tanpa baterai
    expect(rec.comparison.every(o => o.qty < rec.choice.qty || o.battery === null)).toBe(true)
    expect(rec.comparison.some(o => o.battery === null)).toBe(true)
    expect(rec.notes).toContain("Tanpa baterai, kelebihan listrik dari panel tidak tersimpan.")
    // daya PLN di atas semua inverter: dipilih yang terbesar dan disarankan hubungi admin
    const big = recommend(parts, s, { pln_power_va: 6600, monthly_bill: 3000000, usage_pattern: "seimbang" })!
    expect(big.inverter.id).toBe(ids.inv5000)
    expect(big.inverter_too_small).toBe(true)
  })

  it("skenario 18: inverter kelas 24 V dengan baterai kelas 24 V bertegangan nominal 25,6 V dianggap cocok", async () => {
    const s = await simSettings(pool), parts = await partsByCategory()
    const rec = recommend(parts, s, { pln_power_va: 2200, monthly_bill: 1000000, usage_pattern: "seimbang" })!
    expect(rec.battery!.id).toBe(ids.bat24) // termurah di antara baterai 24 V
    expect(rec.battery!.voltage_v).toBe(25.6)
    expect(rec.battery_qty).toBe(1)
    expect((await save(simple({ battery_part_id: ids.bat24 }))).status).toBe(201)
    const mismatch = await save(simple({ battery_part_id: ids.bat48 }))
    expect(mismatch.status).toBe(400)
    expect(mismatch.json.code).toBe("BATTERY_MISMATCH")
  })
})

describe("B4 simpan simulasi", () => {
  it("beban dihitung dari tagihan dan pola, susunan panel dari aturan inverter, harga part disalin", async () => {
    const r = await save(simple())
    const sim = r.json.simulation
    // 1.000.000 / 1.500 / (365/12) kWh per hari, porsi siang 40% selama 8 jam
    const daily = 1000000 / 1500 / (365 / 12)
    expect(sim.day_load_kw).toBeCloseTo(daily * 0.4 / 8, 12)
    expect(sim.night_load_kw).toBeCloseTo(daily * 0.6 / 16, 12)
    // seri maksimal floor(245 / (50,1 x 1,05)) = 4
    expect([sim.panel_qty, sim.panel_series, sim.panel_parallel]).toEqual([4, 4, 1])
    expect(sim.snapshot.panel).toMatchObject({ name: "Panel 550 Wp", unit_price: 1700000, voc: 50.1 })
    // investasi = 4 x 1,7 jt + 6,08 jt + 12 jt + 20% aksesoris + 2 jt jasa instalasi
    const components = 4 * 1700000 + 6080000 + 12000000
    expect(sim.est_investment).toBe(components + Math.round(components * 0.2) + 2000000)
    expect(sim.capacity_kwp).toBe(2.2)
    expect(sim.is_locked).toBe(false)
    expect(Array.isArray(sim.tips)).toBe(true)
  })

  it("susunan panel yang tidak bisa dibagi rata atau melebihi batas inverter ditolak", async () => {
    // 450 Wp: seri maksimal floor(245 / 43,575) = 5, jumlah maksimal floor(2700 / 450) = 6, 6 = 2 string x 3
    expect((await save(simple({ panel_part_id: ids.panel450, panel_qty: 6 }))).json.simulation.panel_series).toBe(3)
    const r = await save(simple({ panel_qty: 7 }))
    expect(r.status).toBe(400)
    expect(r.json.code).toBe("INVALID_ARRANGEMENT")
  })

  it("on-grid, part nonaktif, dan mode lengkap untuk non-admin ditolak", async () => {
    expect((await save(simple({ system_type: "on_grid" }))).json.code).toBe("ON_GRID")
    expect((await save(simple({ inverter_part_id: ids.invOnGrid }))).status).toBe(400)
    await pool.query("update parts set is_active = false where id = $1", [ids.bat24mahal])
    expect((await save(simple({ battery_part_id: ids.bat24mahal }))).json.code).toBe("INVALID_PART")
    expect((await save(simple({ overrides: { psh: 5 } }))).status).toBe(403)
    expect((await save(simple({ usage_pattern: "manual", day_load_kw: 1, night_load_kw: 0.3 }))).status).toBe(400)
    expect((await call("POST", "/api/simulations", { body: simple() })).status).toBe(401)
  })

  it("admin memakai mode lengkap: beban manual, susunan, dan angka yang ditimpa", async () => {
    const r = await save(simple({ usage_pattern: "manual", day_load_kw: 1.4, night_load_kw: 0.3, monthly_bill: 5000000, panel_series: 2, panel_parallel: 2,
      overrides: { psh: 4.5, mode: "SOL", vocMax: 250 } }), admin)
    expect(r.status, JSON.stringify(r.json)).toBe(201)
    const s = r.json.simulation
    expect(s.params).toMatchObject({ pDay: 1.4, pNight: 0.3, psh: 4.5, mode: "SOL", vocMax: 250, seri: 2, paralel: 2 })
    expect(s.monthly_saving).toBe(Math.round(legacy(s.params).fin.month))
  })

  it("estimasi jasa instalasi yang belum diisi tim membuat simulasi tidak bisa disimpan", async () => {
    await pool.query("update settings set value = 'null' where key = 'installation_estimate'")
    const r = await save(simple())
    expect(r.status).toBe(409)
    expect(r.json.code).toBe("SETTING_NOT_FILLED")
    await pool.query("update settings set value = '2000000' where key = 'installation_estimate'")
  })

  it("simulasi hanya bisa dibaca pemiliknya dan admin", async () => {
    const other = await userSession(call, "guest")
    const id = (await save(simple())).json.simulation.id
    expect((await call("GET", `/api/simulations/${id}`, { as: other })).status).toBe(404)
    expect((await call("GET", `/api/simulations/${id}`, { as: admin })).status).toBe(200)
    const mine = await call("GET", "/api/simulations", { as: guest })
    expect(mine.json.simulations.length).toBeGreaterThan(5)
    expect((await call("GET", "/api/simulations", { as: other })).json.simulations).toEqual([])
  })
})
