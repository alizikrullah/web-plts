import type { Params, Row, Tip } from "../../../../shared/calc/rumah"
import { arrangement, arrangements, evaluate, recommend, toParams, type Battery, type Config, type Inverter, type Panel, type Pattern, type SimSettings } from "../../../../shared/calc/simulator"
import { bepTxt, n1, rpS } from "../../../../shared/format"

export interface Parts { panels: Panel[]; inverters: Inverter[]; batteries: Battery[] }
export interface SimData { parts: Parts; s: SimSettings; whatsapp: string | null; installationMissing: boolean }

// Isian mode sederhana (PRD 6.1). Disimpan sementara di browser supaya tidak hilang saat daftar (PRD 6.5, skenario 8).
export interface SimpleState {
  type: "hybrid" | "ongrid"; pln: number; bill: number; pattern: Pattern
  panelId: string; qty: number; inverterId: string; batteryId: string | null; batteryQty: number
}
export const PATTERNS: { id: Pattern; label: string }[] = [
  { id: "sepi_siang", label: "Rumah sepi di siang hari" }, { id: "seimbang", label: "Seimbang" }, { id: "ramai_siang", label: "Rumah ramai di siang hari" },
]
const KEY = "plts-simulasi-v2"
export function loadState(): Partial<SimpleState> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") } catch { return {} }
}
export function saveState(st: SimpleState) {
  try { localStorage.setItem(KEY, JSON.stringify(st)) } catch { /* penyimpanan browser diblokir */ }
}

// Pilihan awal dari rekomendasi PRD 6.2.
export function recommended(d: SimData, base: Pick<SimpleState, "type" | "pln" | "bill" | "pattern">): SimpleState | null {
  const r = recommend(d.parts, d.s, { pln_power_va: base.pln, monthly_bill: base.bill, usage_pattern: base.pattern })
  return r && { ...base, panelId: r.choice.panel.id, qty: r.choice.qty, inverterId: r.inverter.id, batteryId: r.battery?.id ?? null, batteryQty: r.battery_qty }
}

export const hybridInverters = (d: SimData) => d.parts.inverters.filter(i => i.system_type === "hybrid_offgrid")
export const batteriesFor = (d: SimData, inv: Inverter | undefined) => d.parts.batteries.filter(b => inv && b.battery_system_v === inv.battery_system_v)

// Menyesuaikan pilihan setelah panel atau inverter diganti: jumlah panel harus bisa dibagi rata ke string inverter,
// dan baterai harus sekelas tegangan dengan inverter.
export function fix(d: SimData, st: SimpleState): SimpleState {
  const panel = d.parts.panels.find(p => p.id === st.panelId), inv = d.parts.inverters.find(i => i.id === st.inverterId)
  const qtys = panel && inv ? arrangements(panel, inv).map(a => a.qty) : []
  const qty = qtys.includes(st.qty) ? st.qty : qtys.filter(q => q < st.qty).pop() ?? qtys[0] ?? st.qty
  const bats = batteriesFor(d, inv)
  const batteryId = st.batteryId === null ? null : bats.some(b => b.id === st.batteryId) ? st.batteryId : [...bats].sort((a, b) => a.unit_price - b.unit_price)[0]?.id ?? null
  return { ...st, qty, batteryId, batteryQty: Math.max(1, st.batteryQty) }
}

export function toConfig(d: SimData, st: SimpleState): Config | null {
  const panel = d.parts.panels.find(p => p.id === st.panelId), inverter = d.parts.inverters.find(i => i.id === st.inverterId)
  const a = panel && inverter && arrangement(panel, inverter, st.qty)
  if (!panel || !inverter || !a || !(String(st.pln) in d.s.tariff_per_va)) return null
  const battery = d.parts.batteries.find(b => b.id === st.batteryId && b.battery_system_v === inverter.battery_system_v) ?? null
  return { pln_power_va: st.pln, monthly_bill: st.bill, usage_pattern: st.pattern, panel, panel_qty: a.qty, panel_series: a.series,
    panel_parallel: a.parallel, inverter, battery, battery_qty: battery ? st.batteryQty : 0 }
}
export const configBody = (c: Config) => ({ system_type: "hybrid_offgrid", pln_power_va: c.pln_power_va, monthly_bill: c.monthly_bill,
  usage_pattern: c.usage_pattern, panel_part_id: c.panel.id, panel_qty: c.panel_qty, inverter_part_id: c.inverter.id,
  battery_part_id: c.battery?.id ?? null, battery_qty: c.battery_qty })

// Tabel pembanding mode sederhana (PRD 6.2 nomor 4): jumlah panel yang lebih sedikit dan pilihan tanpa baterai.
export function compareSimple(c: Config, s: SimSettings) {
  const row = (name: string, cfg: Config) => {
    const e = evaluate(toParams(cfg, s))
    return { name, kwp: e.result.capacity_kwp, saving: e.result.monthly_saving, invest: e.result.est_investment, bep: e.result.bep_years }
  }
  const fewer = arrangements(c.panel, c.inverter).filter(a => a.qty < c.panel_qty).reverse()
  return [row("Pilihan Anda", c), ...fewer.map(a => row(`${a.qty} panel`, { ...c, panel_qty: a.qty, panel_series: a.series, panel_parallel: a.parallel })),
    ...(c.battery ? [row("Tanpa baterai", { ...c, battery: null, battery_qty: 0 })] : [])]
}

// PRD 6.4: saran mode sederhana dalam bahasa awam. Kondisinya sama dengan saran simulator lama, termasuk dua kondisi Bahaya
// (tegangan panel melebihi batas inverter, dan tidak balik modal), jadi label Bahaya tetap sama.
export function layTips(p: Params, rows: Row[]): Tip[] {
  const { s: sim, f: fin } = rows[0]
  const out: Tip[] = [], add = (kind: Tip["kind"], text: string) => out.push({ kind, text })
  const vmp = p.seri * p.vmp
  if (p.seri * p.voc * 1.05 > p.vocMax) add("bad", "Tegangan rangkaian panel melebihi batas inverter dan bisa merusaknya. Kurangi panel yang disusun berderet.")
  else add("ok", "Susunan panel aman untuk inverter ini.")
  if (vmp * 0.88 < 30) add("warn", "Saat cuaca panas tegangan panel bisa terlalu rendah untuk inverter. Tambah panel yang disusun berderet.")
  if (vmp > 170) add("warn", "Tegangan panel di atas rentang terbaik inverter, jadi produksi listrik bisa sedikit turun.")
  if (sim.wpTot > p.pvMax) add("warn", "Daya panel melebihi kemampuan inverter, sebagian listrik dari panel terbuang.")
  if (Math.max(p.pDay, p.pNight) * 1000 > p.invRated * 0.8)
    add("warn", "Pemakaian listrik rumah sudah mendekati batas inverter. Hindari menyalakan alat besar seperti pompa air, kulkas, dan AC bersamaan.")
  if (sim.waste + sim.clip > 0.1 * sim.dcDay)
    add("tip", "Sebagian listrik dari panel terbuang. Pakai alat besar seperti mesin cuci, setrika, pompa air, atau AC di jam 10 sampai 14, atau tambah baterai.")
  if (sim.grid > 0.4 * sim.loadE && sim.wpTot < p.pvMax) add("tip", "Sebagian besar listrik rumah masih dari PLN. Menambah panel masih bisa menambah penghematan.")
  if (p.ah > 0) {
    if (sim.charged / Math.max(0.01, sim.cap) < 0.3) add("tip", "Baterai jarang terisi penuh dari panel, jadi lebih berguna sebagai cadangan saat listrik padam. Bandingkan dengan pilihan tanpa baterai.")
    else add("ok", "Baterai terpakai dengan baik setiap hari.")
  }
  const noBat = rows.find(r => r.name === "Tanpa baterai")
  if (noBat && fin.bep !== null && noBat.f.bep !== null && noBat.f.bep < fin.bep - 1)
    add("tip", `Tanpa baterai, balik modal lebih cepat (${bepTxt(noBat.f.bep)}). Baterai tetap berguna kalau listrik sering padam.`)
  if (fin.bep === null) add("bad", `Sistem ini tidak balik modal dalam ${p.years} tahun. Coba ubah jumlah panel atau baterai, atau pakai lebih banyak listrik di siang hari.`)
  else if (fin.bep > 10) add("warn", `Balik modal cukup lama (${bepTxt(fin.bep)}). Pastikan garansi inverter jelas.`)
  else add("ok", `Balik modal ${bepTxt(fin.bep)}, untung bersih ${rpS(fin.net)} selama ${p.years} tahun.`)
  if (p.tagihan > 0) add("tip", `Hemat ${rpS(fin.month)} per bulan, sekitar ${n1(fin.month / p.tagihan * 100, 0)}% dari tagihan Anda.`)
  add("tip", "Panel paling baik menghadap utara dengan kemiringan 10 sampai 15 derajat, dan dibersihkan tiap 1 sampai 2 bulan.")
  return out
}
