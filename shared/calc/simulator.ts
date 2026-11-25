// Aturan Simulator dari PRD bagian 6 di atas rumus lama (rumah.ts): beban dari tagihan, susunan panel,
// paket budget, estimasi investasi, dan umur baterai. Dipakai bersama oleh frontend dan backend.
import { advice, compareOptions, finance, investOf, simulate, type Mode, type Params, type Tip } from "./rumah"

export type SystemType = "hybrid_offgrid" | "on_grid"
export type Tier = "hemat" | "standar" | "premium"
export const TIERS: Tier[] = ["hemat", "standar", "premium"]
export const TIER_LABEL: Record<Tier, string> = { hemat: "Hemat", standar: "Standar", premium: "Premium" }

export interface Panel { id: string; name: string; unit_price: number; wp: number; voc: number; vmp: number; isc?: number | null; package_tier?: Tier | null }
export interface Inverter {
  id: string; name: string; unit_price: number; system_type: SystemType; rated_w: number; pv_max_w: number
  pv_voc_max: number; mppt_v_min: number; mppt_v_max: number; efficiency_pct: number; battery_system_v: number | null
  pv_current_max?: number | null; package_tier?: Tier | null
}
export interface Battery {
  id: string; name: string; unit_price: number; battery_system_v: number; capacity_ah: number; voltage_v: number; dod_pct: number
  cycle_life?: number | null; package_tier?: Tier | null
}
export type QtyBasis = "per_sistem" | "per_string" | "per_panel"
export interface Accessory { id: string; name: string; unit: string; unit_price: number; system_type: SystemType | null; qty_basis: QtyBasis | null; qty_per_basis: number | null }
export interface Catalog { panels: Panel[]; inverters: Inverter[]; batteries: Battery[]; accessories: Accessory[] }
export type Pattern = "sepi_siang" | "seimbang" | "ramai_siang"
export interface SimSettings {
  tariff_per_va: Record<string, number>; sun_hours: number; system_loss_pct: number; panel_degradation_pct: number
  tariff_escalation_pct: number; work_mode: Mode; battery_unlock_soc_pct: number; day_hours: { start: number; end: number }
  analysis_years: number; inverter_replace_year: number; day_share_pct: Record<Pattern, number>
  panel_wp_per_va: number; battery_max_life_years: number; accessories_estimate_pct: number; service_base: number; service_per_kwp: number
}

// Hari per bulan rata-rata, sama dengan rumus lama (hemat per bulan = hemat per tahun / 12).
// Dipakai juga untuk beban dari tagihan, supaya hemat per bulan tidak pernah melebihi tagihan (skenario 16).
export const DAYS_PER_MONTH = 365 / 12

// PRD 6.1: beban dihitung dari tagihan dan pola pemakaian.
export function loadsFromBill(bill: number, tariff: number, sharePct: number, day: { start: number; end: number }) {
  const daily = bill / tariff / DAYS_PER_MONTH
  const dayHours = day.end - day.start
  return { daily_kwh: daily, day_kw: (daily * sharePct / 100) / dayHours, night_kw: (daily * (1 - sharePct / 100)) / (24 - dayHours) }
}

// PRD 6.1: susunan panel. Seri maksimal memakai cadangan suhu dingin 1,05. Panel dibagi rata ke semua string;
// jumlah yang tidak bisa dibagi rata dilewati.
export function maxSeries(panel: Panel, inv: Inverter) { return Math.floor(inv.pv_voc_max / (panel.voc * 1.05)) }
export function arrangement(panel: Panel, inv: Inverter, qty: number) {
  const seriesMax = maxSeries(panel, inv), maxPanels = Math.floor(inv.pv_max_w / panel.wp)
  if (!Number.isInteger(qty) || qty < 1 || qty > maxPanels || seriesMax < 1) return null
  const parallel = Math.ceil(qty / seriesMax)
  return qty % parallel === 0 ? { qty, series: qty / parallel, parallel } : null
}
export function arrangements(panel: Panel, inv: Inverter) {
  const out = []
  for (let q = 1; q <= Math.floor(inv.pv_max_w / panel.wp); q++) { const a = arrangement(panel, inv, q); if (a) out.push(a) }
  return out
}

export interface Config {
  pln_power_va: number; monthly_bill: number; usage_pattern: Pattern | "manual"
  panel: Panel; panel_qty: number; panel_series: number; panel_parallel: number
  inverter: Inverter; battery: Battery | null; battery_qty: number // jenis sistem mengikuti jenis inverter
  accessories?: Accessory[] // katalog aksesoris aktif; yang dipakai disaring di estimasi (PRD 6.3)
  day_load_kw?: number; night_load_kw?: number // hanya untuk pola manual (mode lengkap)
  overrides?: Partial<Params> // mode lengkap: admin boleh menimpa angka apa pun
}
export const isOnGrid = (c: Pick<Config, "inverter">) => c.inverter.system_type === "on_grid"

// Pembulatan estimasi ke atas ke kelipatan Rp50.000 (PRD 6.3). Cadangan kecil menahan sisa pecahan dari perkalian desimal.
const up50k = (x: number) => Math.ceil(x / 50000 - 1e-9) * 50000

// PRD 6.3: aksesoris dengan aturan jumlah yang berlaku untuk jenis sistem ini, jumlahnya dibulatkan ke atas.
export function accessoryLines(c: Config) {
  const base: Record<QtyBasis, number> = { per_sistem: 1, per_string: c.panel_parallel, per_panel: c.panel_qty }
  return (c.accessories ?? [])
    .filter(a => a.qty_basis && a.qty_per_basis && (a.system_type === null || a.system_type === c.inverter.system_type))
    .map(a => {
      const qty = Math.ceil(a.qty_per_basis! * base[a.qty_basis!] - 1e-9)
      return { part_id: a.id, name: a.name, unit: a.unit, unit_price: a.unit_price, qty, subtotal: qty * a.unit_price }
    })
}

// PRD 6.3: estimasi investasi kasar = komponen utama + aksesoris + jasa.
export function investment(c: Config, s: SimSettings) {
  const battery = isOnGrid(c) ? null : c.battery
  const components = c.panel.unit_price * c.panel_qty + c.inverter.unit_price + (battery ? battery.unit_price * c.battery_qty : 0)
  const lines = accessoryLines(c), fromPct = lines.length === 0
  const accessories = up50k(fromPct ? components * s.accessories_estimate_pct / 100 : lines.reduce((t, l) => t + l.subtotal, 0))
  const service = up50k(s.service_base + s.service_per_kwp * (c.panel.wp * c.panel_qty) / 1000)
  return { components, accessories, accessory_lines: lines, accessories_from_pct: fromPct, service, total: components + accessories + service }
}

// PRD 6.3: umur baterai dari jumlah siklus, dibatasi umur maksimal, dibulatkan ke tahun terdekat dan minimal 1 tahun.
export const lifeYears = (cycles: number | null | undefined, perDay: number, max: number) =>
  Math.max(1, Math.round(cycles && perDay > 1e-6 ? Math.min(max, cycles / (perDay * 365)) : max))
// Siklus per hari = energi yang masuk ke baterai per hari ÷ kapasitas baterai (angka yang sama dengan saran baterai).
export const cyclesPerDay = (p: Params) => { const sim = simulate(p); return sim.cap > 0 ? sim.charged / sim.cap : 0 }

// Menyusun isian rumus lama dari part, susunan, tagihan, dan Pengaturan. On-grid = rumus yang sama dengan baterai 0 (PRD 6.1).
export function toParams(c: Config, s: SimSettings): Params {
  const onGrid = isOnGrid(c), battery = onGrid ? null : c.battery
  const tarif = s.tariff_per_va[String(c.pln_power_va)]
  const loads = c.usage_pattern === "manual"
    ? { day_kw: c.day_load_kw!, night_kw: c.night_load_kw! }
    : loadsFromBill(c.monthly_bill, tarif, s.day_share_pct[c.usage_pattern], s.day_hours)
  const inv = investment(c, s)
  const p: Params = {
    tarif, tagihan: c.monthly_bill, esc: s.tariff_escalation_pct,
    wp: c.panel.wp, seri: c.panel_series, paralel: c.panel_parallel, psh: s.sun_hours, voc: c.panel.voc, vmp: c.panel.vmp,
    loss: s.system_loss_pct, deg: s.panel_degradation_pct,
    pvMax: c.inverter.pv_max_w, vocMax: c.inverter.pv_voc_max, invRated: c.inverter.rated_w, invEff: c.inverter.efficiency_pct,
    ah: battery ? battery.capacity_ah * c.battery_qty : 0, bv: battery?.voltage_v ?? 0, dod: battery?.dod_pct ?? 0,
    mode: s.work_mode, unlock: s.battery_unlock_soc_pct,
    pDay: loads.day_kw, pNight: loads.night_kw, hStart: s.day_hours.start, hEnd: s.day_hours.end,
    cPanel: c.panel.unit_price, cInv: c.inverter.unit_price, cBat: battery ? battery.unit_price * c.battery_qty : 0,
    cEtc: inv.accessories + inv.service,
    yInv: s.inverter_replace_year, yBat: 0, years: s.analysis_years,
    mpptMin: c.inverter.mppt_v_min, mpptMax: c.inverter.mppt_v_max, onGrid,
    ...(c.panel.isc ? { isc: c.panel.isc } : {}), ...(c.inverter.pv_current_max ? { iMax: c.inverter.pv_current_max } : {}),
  }
  if (battery) p.yBat = lifeYears(battery.cycle_life, cyclesPerDay(p), s.battery_max_life_years)
  return { ...p, ...c.overrides }
}

// PRD 6.4: saran yang hanya berlaku untuk satu produk dipindah ke catatan part itu, jadi tidak ikut tampil.
const PRODUCT_SPECIFIC = ["Gunakan setting tipe baterai USER"]

// Menghitung satu konfigurasi dengan rumus lama.
export function evaluate(p: Params) {
  const sim = simulate(p), invest = investOf(p), fin = finance(p, sim, invest)
  const { rows, best } = compareOptions(p)
  const tips: Tip[] = advice(p, rows).filter(t => !PRODUCT_SPECIFIC.some(s => t.text.startsWith(s)))
  return {
    params: p, sim, fin, rows, best, tips,
    result: {
      est_investment: Math.round(invest),
      capacity_kwp: sim.wpTot / 1000,
      daily_production_kwh: sim.dcDay,
      daily_saved_kwh: sim.saved,
      monthly_saving: Math.round(fin.month),
      net_profit: Math.round(fin.net),
      bep_years: fin.bep,
    },
    pv_used_pct: sim.dcDay > 0 ? sim.saved / (sim.dcDay * p.invEff / 100) * 100 : 0,
    danger: tips.some(t => t.kind === "bad"),
  }
}

export interface Package { tier: Tier; config: Config; result: ReturnType<typeof evaluate>["result"]; inverter_too_small: boolean }

// PRD 6.2: tiga paket Hemat, Standar, dan Premium. Kapasitas panel sama (daya PLN × faktor), yang beda merek dan harga.
// Kelas yang partnya tidak lengkap tidak menjadi paket, dan part dari kelas lain tidak dipakai untuk menutupnya.
export function packages(cat: Catalog, s: SimSettings, input: { system_type: SystemType; pln_power_va: number; monthly_bill: number; usage_pattern: Pattern }) {
  const target = input.pln_power_va * s.panel_wp_per_va, hybrid = input.system_type === "hybrid_offgrid"
  const out: Package[] = []
  for (const tier of TIERS) {
    const invs = cat.inverters.filter(i => i.package_tier === tier && i.system_type === input.system_type)
      .sort((a, b) => a.rated_w - b.rated_w || a.unit_price - b.unit_price)
    if (!invs.length) continue
    let fit: Inverter | undefined
    if (hybrid) fit = invs.find(i => i.rated_w >= input.pln_power_va)
    else {
      const enough = invs.filter(i => i.pv_max_w >= target)
      fit = enough.find(i => target / i.rated_w >= 1.1 && target / i.rated_w <= 1.4) ?? enough[0]
    }
    const inverter = fit ?? invs[invs.length - 1]

    let battery: Battery | null = null
    if (hybrid) {
      const bats = cat.batteries.filter(b => b.package_tier === tier && b.battery_system_v === inverter.battery_system_v)
      battery = bats.filter(b => b.capacity_ah >= 100).sort((a, b) => a.capacity_ah - b.capacity_ah || a.unit_price - b.unit_price)[0]
        ?? [...bats].sort((a, b) => b.capacity_ah - a.capacity_ah || a.unit_price - b.unit_price)[0] ?? null
      if (!battery) continue
    }

    let best: { panel: Panel; a: { qty: number; series: number; parallel: number }; cost: number; gap: number } | null = null
    for (const panel of cat.panels.filter(p => p.package_tier === tier)) {
      const arrs = arrangements(panel, inverter)
      if (!arrs.length) continue
      const a = arrs.find(x => x.qty * panel.wp >= target) ?? arrs[arrs.length - 1]
      const cost = panel.unit_price * a.qty, gap = Math.abs(a.qty * panel.wp - target)
      if (!best || cost < best.cost || (cost === best.cost && gap < best.gap)) best = { panel, a, cost, gap }
    }
    if (!best) continue

    const config: Config = { pln_power_va: input.pln_power_va, monthly_bill: input.monthly_bill, usage_pattern: input.usage_pattern,
      panel: best.panel, panel_qty: best.a.qty, panel_series: best.a.series, panel_parallel: best.a.parallel,
      inverter, battery, battery_qty: battery ? 1 : 0, accessories: cat.accessories }
    out.push({ tier, config, result: evaluate(toParams(config, s)).result, inverter_too_small: !fit })
  }
  return out
}

// Konfigurasi yang persis sama dengan paket (part, jumlah, dan susunan) tercatat sebagai paket itu.
export function samePackage(c: Config, pk: Package) {
  const k = pk.config
  return c.panel.id === k.panel.id && c.panel_qty === k.panel_qty && c.panel_series === k.panel_series && c.inverter.id === k.inverter.id
    && (c.battery?.id ?? null) === (k.battery?.id ?? null) && c.battery_qty === k.battery_qty
}
