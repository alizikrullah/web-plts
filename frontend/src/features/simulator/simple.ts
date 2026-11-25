import type { Params, Row, Tip } from "../../../../shared/calc/rumah"
import { arrangement, arrangements, packages, type Catalog, type Config, type Inverter, type Package, type Pattern, type SimSettings, type SystemType,
  type Tier } from "../../../../shared/calc/simulator"
import { bepTxt, n1, rpS } from "../../../../shared/format"

export interface SimData { parts: Catalog; s: SimSettings; whatsapp: string | null }

// Isian mode sederhana (PRD 6.1 dan 6.2). Disimpan sementara di browser supaya tidak hilang saat daftar (PRD 6.5, skenario 8).
// tier kosong berarti part diatur sendiri.
export interface SimpleState {
  type: "hybrid" | "ongrid"; pln: number; bill: number; pattern: Pattern; tier: Tier | null
  panelId: string; qty: number; inverterId: string; batteryId: string | null; batteryQty: number
}
export type Base = Pick<SimpleState, "type" | "pln" | "bill" | "pattern">
export const PATTERNS: { id: Pattern; label: string }[] = [
  { id: "sepi_siang", label: "Rumah sepi di siang hari" }, { id: "seimbang", label: "Seimbang" }, { id: "ramai_siang", label: "Rumah ramai di siang hari" },
]
const KEY = "plts-simulasi-v3"
export function loadState(): Partial<SimpleState> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") } catch { return {} }
}
export function saveState(st: SimpleState) {
  try { localStorage.setItem(KEY, JSON.stringify(st)) } catch { /* penyimpanan browser diblokir */ }
}

// Keterangan wajib di hasil on-grid (PRD 6.2).
export const ONGRID_NOTE = "Kelebihan listrik dari panel terbuang dan tidak mengurangi tagihan. Saat PLN padam, sistem on-grid ikut mati."

export const systemOf =(b: Pick<SimpleState, "type">): SystemType => (b.type === "ongrid" ? "on_grid" : "hybrid_offgrid")

// Paket Hemat, Standar, dan Premium untuk rumah ini (PRD 6.2).
export const packagesFor = (d: SimData, b: Base) =>
  packages(d.parts, d.s, { system_type: systemOf(b), pln_power_va: b.pln, monthly_bill: b.bill, usage_pattern: b.pattern })
export const fromPackage = (b: Base, pk: Package): SimpleState => ({ ...b, tier: pk.tier, panelId: pk.config.panel.id, qty: pk.config.panel_qty,
  inverterId: pk.config.inverter.id, batteryId: pk.config.battery?.id ?? null, batteryQty: pk.config.battery_qty || 1 })
// Paket yang diminta kalau ada, lalu Standar, lalu paket pertama yang tersedia.
export function choosePackage(pk: Package[], b: Base, want: Tier | null): SimpleState | null {
  const p = pk.find(x => x.tier === want) ?? pk.find(x => x.tier === "standar") ?? pk[0]
  return p ? fromPackage(b, p) : null
}

export const invertersOf = (d: SimData, type: SystemType) => d.parts.inverters.filter(i => i.system_type === type)
export const batteriesFor = (d: SimData, inv: Inverter | undefined) =>
  inv?.system_type === "hybrid_offgrid" ? d.parts.batteries.filter(b => b.battery_system_v === inv.battery_system_v) : []

// Menyesuaikan pilihan setelah panel atau inverter diganti di Atur sendiri: jumlah panel harus bisa dibagi rata ke string inverter,
// dan baterai harus sekelas tegangan dengan inverter. On-grid tidak memakai baterai.
export function fix(d: SimData, st: SimpleState): SimpleState {
  const panel = d.parts.panels.find(p => p.id === st.panelId), inv = d.parts.inverters.find(i => i.id === st.inverterId)
  const qtys = panel && inv ? arrangements(panel, inv).map(a => a.qty) : []
  const qty = qtys.includes(st.qty) ? st.qty : qtys.filter(q => q < st.qty).pop() ?? qtys[0] ?? st.qty
  const bats = batteriesFor(d, inv)
  const batteryId = st.batteryId === null || !bats.length ? null
    : bats.some(b => b.id === st.batteryId) ? st.batteryId : [...bats].sort((a, b) => a.unit_price - b.unit_price)[0].id
  return { ...st, qty, batteryId, batteryQty: Math.max(1, st.batteryQty) }
}

export function toConfig(d: SimData, st: SimpleState): Config | null {
  const panel = d.parts.panels.find(p => p.id === st.panelId), inverter = d.parts.inverters.find(i => i.id === st.inverterId)
  const a = panel && inverter && inverter.system_type === systemOf(st) && arrangement(panel, inverter, st.qty)
  if (!panel || !inverter || !a || !(String(st.pln) in d.s.tariff_per_va)) return null
  const battery = batteriesFor(d, inverter).find(b => b.id === st.batteryId) ?? null
  return { pln_power_va: st.pln, monthly_bill: st.bill, usage_pattern: st.pattern, panel, panel_qty: a.qty, panel_series: a.series,
    panel_parallel: a.parallel, inverter, battery, battery_qty: battery ? st.batteryQty : 0, accessories: d.parts.accessories }
}
export const configBody = (c: Config, tier: Tier | null) => ({ system_type: c.inverter.system_type, package_tier: tier, pln_power_va: c.pln_power_va,
  monthly_bill: c.monthly_bill, usage_pattern: c.usage_pattern, panel_part_id: c.panel.id, panel_qty: c.panel_qty, inverter_part_id: c.inverter.id,
  battery_part_id: c.battery?.id ?? null, battery_qty: c.battery_qty })

// PRD 6.4: saran mode sederhana dalam bahasa awam. Kondisinya sama dengan saran simulator (rumah.ts), termasuk kondisi Bahaya
// (tegangan panel melebihi batas inverter, arus beberapa string paralel melebihi batas, dan tidak balik modal), jadi label Bahaya tetap sama.
export function layTips(p: Params, rows: Row[]): Tip[] {
  const { s: sim, f: fin } = rows[0]
  const out: Tip[] = [], add = (kind: Tip["kind"], text: string) => out.push({ kind, text })
  const vmp = p.seri * p.vmp, lo = p.mpptMin ?? 30, hi = p.mpptMax ?? 170
  if (p.seri * p.voc * 1.05 > p.vocMax) add("bad", "Tegangan rangkaian panel melebihi batas inverter dan bisa merusaknya. Kurangi panel yang disusun berderet.")
  else add("ok", "Susunan panel aman untuk inverter ini.")
  if (vmp * 0.88 < lo) add("warn", "Saat cuaca panas tegangan panel bisa terlalu rendah untuk inverter. Tambah panel yang disusun berderet.")
  if (vmp > hi) add("warn", "Tegangan panel di atas rentang terbaik inverter, jadi produksi listrik bisa sedikit turun.")
  if (p.isc && p.iMax && p.isc * p.paralel > p.iMax) add(p.paralel > 1 ? "bad" : "warn", p.paralel > 1
    ? "Arus dari beberapa rangkaian panel yang digabung melebihi batas inverter dan berbahaya. Kurangi rangkaian yang digabung."
    : "Arus panel sedikit di atas batas inverter. Saat terik sebagian listrik terpotong, tetapi masih aman.")
  if (p.onGrid) {
    const ratio = sim.wpTot / p.invRated
    if (ratio < 1.1) add("warn", "Inverter lebih besar dari yang dibutuhkan panel. Pilihan inverter yang lebih kecil biasanya lebih hemat biaya.")
    else if (ratio > 1.4) add("warn", "Panel terlalu banyak untuk inverter ini, sebagian listrik saat terik terpotong.")
  }
  if (sim.wpTot > p.pvMax) add("warn", "Daya panel melebihi kemampuan inverter, sebagian listrik dari panel terbuang.")
  if (!p.onGrid && Math.max(p.pDay, p.pNight) * 1000 > p.invRated * 0.8)
    add("warn", "Pemakaian listrik rumah sudah mendekati batas inverter. Hindari menyalakan alat besar seperti pompa air, kulkas, dan AC bersamaan.")
  if (sim.waste + sim.clip > 0.1 * sim.dcDay) add("tip", p.onGrid
    ? "Sebagian listrik dari panel terbuang karena tidak mengurangi tagihan. Pakai alat besar seperti mesin cuci, setrika, pompa air, atau AC di jam 10 sampai 14."
    : "Sebagian listrik dari panel terbuang. Pakai alat besar seperti mesin cuci, setrika, pompa air, atau AC di jam 10 sampai 14, atau tambah baterai.")
  if (!p.onGrid && sim.grid > 0.4 * sim.loadE && sim.wpTot < p.pvMax) add("tip", "Sebagian besar listrik rumah masih dari PLN. Menambah panel masih bisa menambah penghematan.")
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
