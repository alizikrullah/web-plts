import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Params } from "../../../../shared/calc/rumah.js"
import { arrangements, evaluate, investment, lifeYears, packages, toParams, type Battery, type Inverter, type Panel } from "../../../../shared/calc/simulator.js"
import { pool } from "../../core/db.js"
import { catalog, simSettings } from "./simulations.js"
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
const onGrid = (o: Record<string, unknown> = {}) => simple({ system_type: "on_grid", inverter_part_id: ids.invOnGrid2000, battery_part_id: null, battery_qty: 0, ...o })
const house = (o: Record<string, unknown> = {}) => ({ system_type: "hybrid_offgrid" as const, pln_power_va: 2200, monthly_bill: 1000000, usage_pattern: "seimbang" as const, ...o })
const up50k = (x: number) => Math.ceil(x / 50000) * 50000

describe("B4 skenario uji", () => {
  it("skenario 15: isian yang sama di simulator HTML lama dan modul baru memberi hemat, BEP, dan aliran energi yang sama", async () => {
    const cases = [simple(), simple({ battery_part_id: null, battery_qty: 0 }), simple({ usage_pattern: "ramai_siang", monthly_bill: 3500000, panel_qty: 3 }),
      simple({ usage_pattern: "sepi_siang", monthly_bill: 300000, panel_qty: 2, pln_power_va: 900 }), simple({ battery_qty: 2, panel_part_id: ids.panel450, panel_qty: 6 }),
      onGrid(), onGrid({ usage_pattern: "ramai_siang", monthly_bill: 2500000 })]
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

  it("skenario 16: hemat per bulan di mode sederhana tidak pernah melebihi tagihan, hybrid maupun on-grid", async () => {
    const s = await simSettings(pool), parts = await catalog(pool)
    let checked = 0
    for (const inverter of parts.inverters)
      for (const panel of parts.panels)
        for (const a of arrangements(panel, inverter))
          for (const battery of [null, ...parts.batteries.filter(b => inverter.system_type === "hybrid_offgrid" && b.battery_system_v === inverter.battery_system_v)])
            for (const usage_pattern of ["sepi_siang", "seimbang", "ramai_siang"] as const)
              for (const monthly_bill of [50000, 400000, 1000000, 6000000])
                for (const pln_power_va of [900, 2200, 6600]) {
                  const p = toParams({ pln_power_va, monthly_bill, usage_pattern, panel, panel_qty: a.qty, panel_series: a.series,
                    panel_parallel: a.parallel, inverter, battery, battery_qty: battery ? 1 : 0, accessories: parts.accessories }, s)
                  expect(evaluate(p).result.monthly_saving, JSON.stringify({ panel: panel.name, a, monthly_bill, usage_pattern })).toBeLessThanOrEqual(monthly_bill)
                  checked++
                }
    expect(checked).toBeGreaterThan(1000)
    // juga lewat API: sistem besar dengan tagihan kecil
    const r = await save(simple({ monthly_bill: 100000, panel_qty: 4, battery_qty: 2 }))
    expect(r.json.simulation.monthly_saving).toBeLessThanOrEqual(100000)
  })

  it("skenario 17: daya PLN 2200 VA, inverter hybrid 3000 W dan panel 550 Wp kelas Standar: paket Standar memakai inverter 3000 W dan 4 panel", async () => {
    const s = await simSettings(pool), cat = await catalog(pool)
    const std = packages(cat, s, house()).find(p => p.tier === "standar")!
    expect(std.config.inverter.id).toBe(ids.inv3000)
    expect([std.config.panel.id, std.config.panel_qty, std.config.panel.wp * std.config.panel_qty]).toEqual([ids.panel550, 4, 2200])
    expect(std.inverter_too_small).toBe(false)
    // daya PLN di atas semua inverter kelas itu: dipilih yang terbesar dan disarankan hubungi admin
    const big = packages(cat, s, house({ pln_power_va: 6600, monthly_bill: 3000000 })).find(p => p.tier === "premium")!
    expect(big.config.inverter.id).toBe(ids.inv5000)
    expect(big.inverter_too_small).toBe(true)
  })

  it("skenario 18: inverter kelas 24 V dengan baterai kelas 24 V bertegangan nominal 25,6 V dianggap cocok", async () => {
    const s = await simSettings(pool), cat = await catalog(pool)
    const std = packages(cat, s, house()).find(p => p.tier === "standar")!
    expect(std.config.battery).toMatchObject({ id: ids.bat24, battery_system_v: 24, voltage_v: 25.6 })
    expect(std.config.battery_qty).toBe(1)
    expect((await save(simple({ battery_part_id: ids.bat24 }))).status).toBe(201)
    const mismatch = await save(simple({ battery_part_id: ids.bat48 }))
    expect(mismatch.status).toBe(400)
    expect(mismatch.json.code).toBe("BATTERY_MISMATCH")
  })
})

describe("Tahap lanjutan skenario uji", () => {
  it("skenario 21: on-grid dengan rumah sepi di siang hari: pemakaian malam dari PLN, kelebihan siang terbuang", async () => {
    const r = await save(onGrid({ usage_pattern: "sepi_siang" }))
    expect(r.status, JSON.stringify(r.json)).toBe(201)
    const sim = r.json.simulation, e = evaluate(sim.params as Params)
    expect(sim).toMatchObject({ system_type: "on_grid", battery_part_id: null, battery_qty: 0, snapshot: { battery: null, battery_life_years: null } })
    expect([e.sim.bat, e.sim.charged]).toEqual([0, 0])
    // energi beban saat panel tidak menghasilkan (jam 18 sampai 06) seluruhnya dari PLN
    const night = e.sim.prof.load.reduce((t, w, i) => t + (e.sim.prof.pv[i] === 0 ? w * 0.25 : 0), 0) / 1000
    expect(night).toBeGreaterThan(0)
    expect(e.sim.grid).toBeGreaterThanOrEqual(night - 1e-9)
    expect(e.sim.grid).toBeCloseTo(e.sim.loadE - e.sim.pvDirect, 9)
    expect(e.sim.waste).toBeGreaterThan(0)
    expect(sim.tips.some((t: any) => t.text.includes("tidak mengurangi tagihan"))).toBe(true)
    // on-grid menolak baterai dan inverter hybrid
    expect((await save(onGrid({ battery_part_id: ids.bat24, battery_qty: 1 }))).status).toBe(400)
    expect((await save(onGrid({ inverter_part_id: ids.inv3000 }))).json.code).toBe("INVALID_PART")
  })

  it("skenario 22: tiga paket untuk rumah 2200 VA memakai jumlah panel terkecil yang kapasitasnya minimal 2.200 Wp", async () => {
    const s = await simSettings(pool), cat = await catalog(pool)
    const pk = packages(cat, s, house())
    expect(pk.map(p => p.tier)).toEqual(["hemat", "standar", "premium"])
    expect(pk.map(p => [p.config.panel.wp, p.config.panel_qty])).toEqual([[400, 6], [550, 4], [600, 4]])
    for (const p of pk) {
      expect(p.config.panel.wp * p.config.panel_qty).toBeGreaterThanOrEqual(2200)
      expect(p.config.panel.wp * (p.config.panel_qty - 1)).toBeLessThan(2200)
      expect(p.config.panel.package_tier).toBe(p.tier)
      expect(p.config.battery!.capacity_ah).toBeGreaterThanOrEqual(100)
    }
    // on-grid: inverter terkecil dengan rasio 1,1 sampai 1,4, tanpa baterai
    const og = packages(cat, s, house({ system_type: "on_grid" }))
    expect(og.map(p => [p.tier, p.config.inverter.id, p.config.battery, p.config.panel_qty])).toEqual([["standar", ids.invOnGrid2000, null, 4]])
  })

  it("skenario 23: harga inverter Premium dinaikkan, estimasi aksesoris Premium tidak berubah dan sama dengan paket lain yang panel dan stringnya sama", async () => {
    const s = await simSettings(pool)
    const acc = (pk: ReturnType<typeof packages>, tier: string) => investment(pk.find(p => p.tier === tier)!.config, s).accessories
    const before = packages(await catalog(pool), s, house())
    await pool.query("update parts set unit_price = unit_price * 3 where id = $1", [ids.inv5000])
    const after = packages(await catalog(pool), s, house())
    await pool.query("update parts set unit_price = 9500000 where id = $1", [ids.inv5000])
    expect(after.find(p => p.tier === "premium")!.result.est_investment).toBeGreaterThan(before.find(p => p.tier === "premium")!.result.est_investment)
    expect(acc(after, "premium")).toBe(acc(before, "premium"))
    // Standar dan Premium sama-sama 4 panel dalam 1 string: kabel PV 30 m dan rail 6 m (1,4 m × 4 dibulatkan ke atas)
    expect(acc(after, "premium")).toBe(acc(after, "standar"))
    expect(acc(after, "standar")).toBe(up50k(30 * 27000 + 6 * 60000))
  })

  it("skenario 24: umur baterai dari jumlah siklus, dibatasi umur maksimal 10 tahun", async () => {
    expect(lifeYears(2000, 0.8, 10)).toBe(7)
    expect(lifeYears(6000, 0.8, 10)).toBe(10)
    expect(lifeYears(null, 0.8, 10)).toBe(10)
    expect(lifeYears(3000, 0, 10)).toBe(10)
    expect(lifeYears(100, 1, 10)).toBe(1)
    // lewat simpan simulasi: umur tersimpan di salinan dan dipakai sebagai tahun ganti baterai di rumus lama
    const r = (await save(simple({ inverter_part_id: ids.inv3000hemat, battery_part_id: ids.bat24hemat }))).json.simulation
    const perDay = evaluate(r.params).sim.charged / evaluate(r.params).sim.cap
    expect(r.params.yBat).toBe(lifeYears(2000, perDay, 10))
    expect(r.snapshot.battery_life_years).toBe(r.params.yBat)
    // sebelum tahap lanjutan ganti baterai tidak dihitung; sekarang biayanya masuk dan untung bersih turun
    expect(Math.round(legacy({ ...r.params, yBat: 0 }).fin.net)).toBeGreaterThan(r.net_profit)
  })

  it("skenario 25: kelas Premium tanpa baterai yang cocok dengan inverternya tidak tampil, kelas lain tetap", async () => {
    const s = await simSettings(pool)
    await pool.query("update parts set package_tier = null where id = $1", [ids.bat48])
    const pk = packages(await catalog(pool), s, house())
    await pool.query("update parts set package_tier = 'premium' where id = $1", [ids.bat48])
    expect(pk.map(p => p.tier)).toEqual(["hemat", "standar"])
  })
})

describe("B4 simpan simulasi", () => {
  it("beban dihitung dari tagihan dan pola, susunan panel dari aturan inverter, harga dan estimasi disalin", async () => {
    const r = await save(simple())
    const sim = r.json.simulation
    // 1.000.000 / 1.500 / (365/12) kWh per hari, porsi siang 40% selama 8 jam
    const daily = 1000000 / 1500 / (365 / 12)
    expect(sim.day_load_kw).toBeCloseTo(daily * 0.4 / 8, 12)
    expect(sim.night_load_kw).toBeCloseTo(daily * 0.6 / 16, 12)
    // seri maksimal floor(245 / (50,1 x 1,05)) = 4
    expect([sim.panel_qty, sim.panel_series, sim.panel_parallel]).toEqual([4, 4, 1])
    expect(sim.snapshot.panel).toMatchObject({ name: "Panel 550 Wp", unit_price: 1700000, voc: 50.1 })
    // investasi = komponen + aksesoris dari List Part (kabel PV dan rail, tanpa pembatas ekspor khusus on-grid) + jasa per kWp
    const components = 4 * 1700000 + 6080000 + 12000000
    const accessories = up50k(30 * 27000 + Math.ceil(1.4 * 4) * 60000), service = 1000000 + 2000000 * 2.2
    expect([accessories, service]).toEqual([1200000, 5400000])
    expect(sim.est_investment).toBe(components + accessories + service)
    expect(sim.snapshot).toMatchObject({ components_total: components, accessories_estimate: accessories, accessories_from_pct: false, service_estimate: service })
    expect(sim.snapshot.accessory_lines.map((l: any) => [l.name, l.qty])).toEqual([["Kabel PV 4 mm", 30], ["Rail aluminium", 6]])
    expect(sim.capacity_kwp).toBe(2.2)
    expect(sim.is_locked).toBe(false)
    expect(Array.isArray(sim.tips)).toBe(true)
    // on-grid memakai pembatas ekspor
    const og = (await save(onGrid())).json.simulation
    expect(og.snapshot.accessory_lines.map((l: any) => l.name)).toContain("Pembatas ekspor")
  })

  it("tanpa aksesoris beraturan, estimasi aksesoris memakai persen cadangan 20% dibulatkan ke atas ke Rp50.000", async () => {
    await pool.query("update parts set is_active = false where qty_basis is not null")
    const sim = (await save(simple())).json.simulation
    await pool.query("update parts set is_active = true where qty_basis is not null")
    const components = 4 * 1700000 + 6080000 + 12000000
    expect(sim.snapshot).toMatchObject({ accessories_from_pct: true, accessories_pct: 20, accessories_estimate: up50k(components * 0.2), accessory_lines: [] })
  })

  it("paket tercatat hanya kalau konfigurasinya persis paket itu", async () => {
    const std = { panel_part_id: ids.panel550, panel_qty: 4, inverter_part_id: ids.inv3000, battery_part_id: ids.bat24, battery_qty: 1, package_tier: "standar" }
    expect((await save(simple(std))).json.simulation.package_tier).toBe("standar")
    expect((await save(simple({ ...std, panel_qty: 3 }))).json.simulation.package_tier).toBeNull()
    expect((await save(simple({ ...std, package_tier: "premium" }))).json.simulation.package_tier).toBeNull()
    expect((await save(simple({ ...std, package_tier: "mewah" }))).status).toBe(400)
  })

  it("susunan panel yang tidak bisa dibagi rata atau melebihi batas inverter ditolak", async () => {
    // 450 Wp: seri maksimal floor(245 / 43,575) = 5, jumlah maksimal floor(2700 / 450) = 6, 6 = 2 string x 3
    expect((await save(simple({ panel_part_id: ids.panel450, panel_qty: 6 }))).json.simulation.panel_series).toBe(3)
    const r = await save(simple({ panel_qty: 7 }))
    expect(r.status).toBe(400)
    expect(r.json.code).toBe("INVALID_ARRANGEMENT")
  })

  it("jenis inverter yang tidak cocok, part nonaktif, dan mode lengkap untuk non-admin ditolak", async () => {
    expect((await save(simple({ inverter_part_id: ids.invOnGrid }))).json.code).toBe("INVALID_PART")
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

  it("cek string memakai batas MPPT dan arus dari List Part: arus 2 string paralel di atas batas adalah Bahaya", async () => {
    const s = await simSettings(pool), cat = await catalog(pool)
    const inverter = cat.inverters.find(i => i.id === ids.invOnGrid2000)!, panel = cat.panels.find(p => p.id === ids.panel600)! as Panel
    const base = { pln_power_va: 2200, monthly_bill: 1000000, usage_pattern: "seimbang" as const, panel, inverter: inverter as Inverter, battery: null as Battery | null, battery_qty: 0 }
    // 600 Wp, Isc 14 A: 1 string di bawah batas 15 A aman, 2 string paralel 28 A berbahaya
    const one = evaluate(toParams({ ...base, panel_qty: 4, panel_series: 4, panel_parallel: 1 }, s))
    expect(one.danger).toBe(false)
    const two = evaluate(toParams({ ...base, panel_qty: 4, panel_series: 2, panel_parallel: 2 }, s))
    expect(two.tips.find(t => t.text.startsWith("Arus 2 string paralel"))?.kind).toBe("bad")
    expect(two.danger).toBe(true)
    // batas MPPT bawah inverter ini 50 V: 1 panel 600 Wp (Vmp 44 V) terlalu rendah
    const low = evaluate(toParams({ ...base, panel_qty: 1, panel_series: 1, panel_parallel: 1 }, s))
    expect(low.tips.some(t => t.kind === "warn" && t.text.includes("batas bawah MPPT 50 V"))).toBe(true)
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
