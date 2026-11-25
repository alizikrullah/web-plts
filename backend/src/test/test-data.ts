import { readFileSync } from "node:fs"
import type { Params } from "../../../shared/calc/rumah.js"
import { pool } from "../core/db.js"
import { insertPart, readPart } from "../features/parts/parts.js"
import { seedDefaults } from "../features/settings/settings-defaults.js"

// Data contoh untuk tes: part dengan angka teknis dari simulator HTML lama, ditambah beberapa variasi.
// Kelas paket (PRD 6.2): Hemat, Standar, dan Premium masing-masing punya panel, inverter hybrid, dan baterai yang cocok.
export const PARTS = {
  panel550: { category: "panel", name: "Panel 550 Wp", unit: "unit", unit_price: 1700000, wp: 550, voc: 50.1, vmp: 42.1, package_tier: "standar" },
  panel450: { category: "panel", name: "Panel 450 Wp", unit: "unit", unit_price: 1450000, wp: 450, voc: 41.5, vmp: 34.6 },
  panel400: { category: "panel", name: "Panel 400 Wp hemat", unit: "unit", unit_price: 1100000, wp: 400, voc: 37, vmp: 31, isc: 13.5, package_tier: "hemat" },
  panel600: { category: "panel", name: "Panel 600 Wp premium", unit: "unit", unit_price: 2600000, wp: 600, voc: 52, vmp: 44, isc: 14, package_tier: "premium" },
  inv1500: { category: "inverter", name: "Inverter 1500 W 12 V", unit: "unit", unit_price: 3500000, system_type: "hybrid_offgrid", rated_w: 1500,
    pv_max_w: 1200, pv_voc_max: 145, mppt_v_min: 30, mppt_v_max: 115, efficiency_pct: 90, battery_system_v: 12 },
  inv3000hemat: { category: "inverter", name: "Inverter 3000 W 24 V hemat", unit: "unit", unit_price: 4500000, system_type: "hybrid_offgrid", rated_w: 3000,
    pv_max_w: 3000, pv_voc_max: 250, mppt_v_min: 30, mppt_v_max: 200, efficiency_pct: 90, battery_system_v: 24, package_tier: "hemat" },
  inv3000: { category: "inverter", name: "Inverter 3000 W 24 V", unit: "unit", unit_price: 6080000, system_type: "hybrid_offgrid", rated_w: 3000,
    pv_max_w: 2700, pv_voc_max: 245, mppt_v_min: 30, mppt_v_max: 170, efficiency_pct: 92, battery_system_v: 24, package_tier: "standar" },
  inv5000: { category: "inverter", name: "Inverter 5000 W 48 V", unit: "unit", unit_price: 9500000, system_type: "hybrid_offgrid", rated_w: 5000,
    pv_max_w: 5500, pv_voc_max: 450, mppt_v_min: 60, mppt_v_max: 400, efficiency_pct: 93, battery_system_v: 48, package_tier: "premium" },
  invOnGrid: { category: "inverter", name: "Inverter on-grid 3000 W", unit: "unit", unit_price: 5000000, system_type: "on_grid", rated_w: 3000,
    pv_max_w: 3300, pv_voc_max: 550, mppt_v_min: 80, mppt_v_max: 500, efficiency_pct: 97, battery_system_v: null, package_tier: "standar" },
  invOnGrid2000: { category: "inverter", name: "Inverter on-grid 2000 W", unit: "unit", unit_price: 7000000, system_type: "on_grid", rated_w: 2000,
    pv_max_w: 2800, pv_voc_max: 500, mppt_v_min: 50, mppt_v_max: 500, pv_current_max: 15, efficiency_pct: 97, battery_system_v: null, package_tier: "standar" },
  bat24hemat: { category: "baterai", name: "LiFePO4 24 V 100 Ah hemat", unit: "unit", unit_price: 9000000, battery_system_v: 24, capacity_ah: 100, voltage_v: 25.6,
    dod_pct: 80, cycle_life: 2000, package_tier: "hemat" },
  bat24: { category: "baterai", name: "LiFePO4 24 V 100 Ah", unit: "unit", unit_price: 12000000, battery_system_v: 24, capacity_ah: 100, voltage_v: 25.6, dod_pct: 90,
    package_tier: "standar" },
  bat24mahal: { category: "baterai", name: "LiFePO4 24 V 100 Ah premium", unit: "unit", unit_price: 15000000, battery_system_v: 24, capacity_ah: 100, voltage_v: 25.6, dod_pct: 95 },
  bat48: { category: "baterai", name: "LiFePO4 48 V 100 Ah", unit: "unit", unit_price: 22000000, battery_system_v: 48, capacity_ah: 100, voltage_v: 51.2, dod_pct: 90,
    cycle_life: 6000, package_tier: "premium" },
  kabel: { category: "aksesoris", name: "Kabel PV 10 mm", unit: "meter", unit_price: 15000 },
  // Aksesoris dengan aturan jumlah untuk estimasi Simulator (PRD 6.3).
  kabelPv: { category: "aksesoris", name: "Kabel PV 4 mm", unit: "meter", unit_price: 27000, qty_basis: "per_string", qty_per_basis: 30 },
  rail: { category: "aksesoris", name: "Rail aluminium", unit: "meter", unit_price: 60000, qty_basis: "per_panel", qty_per_basis: 1.4 },
  limiter: { category: "aksesoris", name: "Pembatas ekspor", unit: "unit", unit_price: 1200000, qty_basis: "per_sistem", qty_per_basis: 1 },
}
export type PartKey = keyof typeof PARTS

// Seed Pengaturan dan status, isi nilai "Diisi tim" dengan angka tes, lalu masukkan semua part contoh.
export async function seedTestData() {
  await seedDefaults(pool)
  await pool.query(`update settings set value = '150000' where key = 'labor_rate_per_day'`)
  await pool.query(`update settings set value = '"Transfer ke BCA 123 a.n. Usaha Tes"' where key = 'payment_instructions'`)
  await pool.query(`update settings set value = '"Usaha PLTS Tes"' where key = 'business_name'`)
  const ids = {} as Record<PartKey, string>
  for (const [k, p] of Object.entries(PARTS)) ids[k as PartKey] = (await insertPart(pool, readPart(p)))!.id
  return ids
}

// Rumus asli diambil langsung dari simulator HTML lama (sama dengan tes paritas di frontend).
const html = readFileSync(new URL("../../../frontend/legacy/simulator-plts-2.html", import.meta.url), "utf8")
const cut = (from: string, to: string) => { const i = html.indexOf(from), j = html.indexOf(to, i)
  if (i < 0 || j < 0) throw new Error(`Potongan "${from}" tidak ketemu di HTML lama`); return html.slice(i, j) }
export const legacy = new Function("p", [cut("const rp=", "/* angka format"), cut("function simulate(", "function css("),
  "const sim=simulate(p),inv=investOf(p),fin=finance(p,sim,inv);", "return {sim,inv,fin};"].join("\n")) as
  (p: Params) => { sim: any; inv: number; fin: { month: number; bep: number | null; net: number } }
