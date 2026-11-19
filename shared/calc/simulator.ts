// Aturan Simulator dari PRD bagian 6 di atas rumus lama (rumah.ts): beban dari tagihan, susunan panel,
// estimasi investasi, dan rekomendasi. Dipakai bersama oleh frontend dan backend.
import { advice, compareOptions, finance, investOf, simulate, type Mode, type Params, type Tip } from "./rumah"

export interface Panel { id: string; name: string; unit_price: number; wp: number; voc: number; vmp: number }
export interface Inverter {
  id: string; name: string; unit_price: number; system_type: "hybrid_offgrid" | "on_grid"; rated_w: number; pv_max_w: number
  pv_voc_max: number; mppt_v_min: number; mppt_v_max: number; efficiency_pct: number; battery_system_v: number | null
}
export interface Battery { id: string; name: string; unit_price: number; battery_system_v: number; capacity_ah: number; voltage_v: number; dod_pct: number }
export type Pattern = "sepi_siang" | "seimbang" | "ramai_siang"
export interface SimSettings {
  tariff_per_va: Record<string, number>; sun_hours: number; system_loss_pct: number; panel_degradation_pct: number
  tariff_escalation_pct: number; work_mode: Mode; battery_unlock_soc_pct: number; day_hours: { start: number; end: number }
  analysis_years: number; inverter_replace_year: number; battery_replace_year: number; day_share_pct: Record<Pattern, number>
  accessories_estimate_pct: number; installation_estimate: number
}

// Hari per bulan rata-rata, sama dengan rumus lama (hemat per bulan = hemat per tahun / 12).
// Dipakai juga untuk beban dari tagihan, supaya hemat per bulan tidak pernah melebihi tagihan (skenario 16).
export const DAYS_PER_MONTH = 365 / 12

// PRD 6.1: beban dihitung dari tagihan dan pola pemakaian. Seluruh beban dianggap tersambung ke inverter.
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

// PRD 6.3: estimasi investasi kasar. Aksesoris = persen dari total panel, inverter, dan baterai, dibulatkan ke rupiah.
export function investment(panel: Panel, qty: number, inv: Inverter, battery: Battery | null, batteryQty: number, s: SimSettings) {
  const components = panel.unit_price * qty + inv.unit_price + (battery ? battery.unit_price * batteryQty : 0)
  const accessories = Math.round(components * s.accessories_estimate_pct / 100)
  return { components, accessories, installation: s.installation_estimate, total: components + accessories + s.installation_estimate }
}

export interface Config {
  pln_power_va: number; monthly_bill: number; usage_pattern: Pattern | "manual"
  panel: Panel; panel_qty: number; panel_series: number; panel_parallel: number
  inverter: Inverter; battery: Battery | null; battery_qty: number
  day_load_kw?: number; night_load_kw?: number // hanya untuk pola manual (mode lengkap)
  overrides?: Partial<Params> // mode lengkap: admin boleh menimpa angka apa pun
}

// Menyusun isian rumus lama dari part, susunan, tagihan, dan Pengaturan.
export function toParams(c: Config, s: SimSettings): Params {
  const tarif = s.tariff_per_va[String(c.pln_power_va)]
  const loads = c.usage_pattern === "manual"
    ? { day_kw: c.day_load_kw!, night_kw: c.night_load_kw! }
    : loadsFromBill(c.monthly_bill, tarif, s.day_share_pct[c.usage_pattern], s.day_hours)
  const inv = investment(c.panel, c.panel_qty, c.inverter, c.battery, c.battery_qty, s)
  const p: Params = {
    tarif, tagihan: c.monthly_bill, esc: s.tariff_escalation_pct,
    wp: c.panel.wp, seri: c.panel_series, paralel: c.panel_parallel, psh: s.sun_hours, voc: c.panel.voc, vmp: c.panel.vmp,
    loss: s.system_loss_pct, deg: s.panel_degradation_pct,
    pvMax: c.inverter.pv_max_w, vocMax: c.inverter.pv_voc_max, invRated: c.inverter.rated_w, invEff: c.inverter.efficiency_pct,
    ah: c.battery ? c.battery.capacity_ah * c.battery_qty : 0, bv: c.battery?.voltage_v ?? 0, dod: c.battery?.dod_pct ?? 0,
    mode: s.work_mode, unlock: s.battery_unlock_soc_pct,
    pDay: loads.day_kw, pNight: loads.night_kw, hStart: s.day_hours.start, hEnd: s.day_hours.end,
    cPanel: c.panel.unit_price, cInv: c.inverter.unit_price, cBat: c.battery ? c.battery.unit_price * c.battery_qty : 0,
    cEtc: inv.accessories + inv.installation,
    yInv: s.inverter_replace_year, yBat: s.battery_replace_year, years: s.analysis_years,
  }
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

export interface Option { panel: Panel; qty: number; series: number; parallel: number; battery: Battery | null; battery_qty: number; monthly_saving: number; est_investment: number; bep_years: number | null }

// PRD 6.2: rekomendasi. Ukuran sistem mengikuti daya PLN rumah, client tetap bebas mengubah.
export function recommend(parts: { panels: Panel[]; inverters: Inverter[]; batteries: Battery[] }, s: SimSettings,
  input: { pln_power_va: number; monthly_bill: number; usage_pattern: Pattern }) {
  // 1. Inverter hybrid/off-grid terkecil dengan daya minimal sama dengan daya PLN; kalau tidak ada, yang terbesar.
  const invs = parts.inverters.filter(i => i.system_type === "hybrid_offgrid").sort((a, b) => a.rated_w - b.rated_w || a.unit_price - b.unit_price)
  if (!invs.length) return null
  const fit = invs.find(i => i.rated_w >= input.pln_power_va)
  const inverter = fit ?? invs[invs.length - 1]
  // 3. Bawaan 1 unit baterai dengan kelas tegangan sama dengan inverter, yang termurah.
  const battery = parts.batteries.filter(b => b.battery_system_v === inverter.battery_system_v)
    .sort((a, b) => a.unit_price - b.unit_price)[0] ?? null
  const batteryQty = battery ? 1 : 0
  const run = (panel: Panel, a: { qty: number; series: number; parallel: number }, bat: Battery | null): Option => {
    const e = evaluate(toParams({ ...input, panel, panel_qty: a.qty, panel_series: a.series, panel_parallel: a.parallel,
      inverter, battery: bat, battery_qty: bat ? batteryQty : 0 }, s))
    return { panel, ...a, battery: bat, battery_qty: bat ? batteryQty : 0, monthly_saving: e.result.monthly_saving,
      est_investment: e.result.est_investment, bep_years: e.result.bep_years }
  }
  // 2. Semua panel aktif dan semua jumlah yang valid; dipilih yang balik modalnya tercepat.
  //    Kalau tidak ada yang balik modal, dipilih hemat per bulan terbesar.
  const all = parts.panels.flatMap(panel => arrangements(panel, inverter).map(a => run(panel, a, battery)))
  if (!all.length) return null
  const rank = (o: Option) => [o.bep_years ?? Infinity, -o.monthly_saving, o.est_investment]
  const best = [...all].sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] })[0]
  // 4. Tabel pembanding: jumlah panel yang lebih sedikit, dan tanpa baterai.
  const fewer = all.filter(o => o.panel.id === best.panel.id && o.qty < best.qty)
  const noBattery = battery ? [run(best.panel, best, null)] : []
  // 5. Ruang tambah panel.
  const most = Math.max(...arrangements(best.panel, inverter).map(a => a.qty))
  return {
    inverter, battery, battery_qty: batteryQty, choice: best,
    inverter_too_small: !fit,
    comparison: [...fewer.sort((a, b) => b.qty - a.qty), ...noBattery],
    extra_panels: most - best.qty,
    notes: [
      ...(!fit ? ["Belum ada inverter yang cukup besar untuk daya PLN rumah ini. Silakan hubungi admin."] : []),
      ...(most > best.qty ? [`Inverter ini masih bisa menampung ${most - best.qty} panel lagi.`] : []),
      // 6. Keterangan tanpa baterai
      "Tanpa baterai, kelebihan listrik dari panel tidak tersimpan.",
    ],
  }
}
