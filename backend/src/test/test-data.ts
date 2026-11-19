import { readFileSync } from "node:fs"
import type { Params } from "../../../shared/calc/rumah.js"
import { pool } from "../core/db.js"
import { insertPart, readPart } from "../features/parts/parts.js"
import { seedDefaults } from "../features/settings/settings-defaults.js"

// Data contoh untuk tes: part dengan angka teknis dari simulator HTML lama, ditambah beberapa variasi.
export const PARTS = {
  panel550: { category: "panel", name: "Panel 550 Wp", unit: "unit", unit_price: 1700000, wp: 550, voc: 50.1, vmp: 42.1 },
  panel450: { category: "panel", name: "Panel 450 Wp", unit: "unit", unit_price: 1450000, wp: 450, voc: 41.5, vmp: 34.6 },
  inv1500: { category: "inverter", name: "Inverter 1500 W 12 V", unit: "unit", unit_price: 3500000, system_type: "hybrid_offgrid", rated_w: 1500,
    pv_max_w: 1200, pv_voc_max: 145, mppt_v_min: 30, mppt_v_max: 115, efficiency_pct: 90, battery_system_v: 12 },
  inv3000: { category: "inverter", name: "Inverter 3000 W 24 V", unit: "unit", unit_price: 6080000, system_type: "hybrid_offgrid", rated_w: 3000,
    pv_max_w: 2700, pv_voc_max: 245, mppt_v_min: 30, mppt_v_max: 170, efficiency_pct: 92, battery_system_v: 24 },
  inv5000: { category: "inverter", name: "Inverter 5000 W 48 V", unit: "unit", unit_price: 9500000, system_type: "hybrid_offgrid", rated_w: 5000,
    pv_max_w: 5500, pv_voc_max: 450, mppt_v_min: 60, mppt_v_max: 400, efficiency_pct: 93, battery_system_v: 48 },
  invOnGrid: { category: "inverter", name: "Inverter on-grid 3000 W", unit: "unit", unit_price: 5000000, system_type: "on_grid", rated_w: 3000,
    pv_max_w: 3300, pv_voc_max: 550, mppt_v_min: 80, mppt_v_max: 500, efficiency_pct: 97, battery_system_v: null },
  bat24: { category: "baterai", name: "LiFePO4 24 V 100 Ah", unit: "unit", unit_price: 12000000, battery_system_v: 24, capacity_ah: 100, voltage_v: 25.6, dod_pct: 90 },
  bat24mahal: { category: "baterai", name: "LiFePO4 24 V 100 Ah premium", unit: "unit", unit_price: 15000000, battery_system_v: 24, capacity_ah: 100, voltage_v: 25.6, dod_pct: 95 },
  bat48: { category: "baterai", name: "LiFePO4 48 V 100 Ah", unit: "unit", unit_price: 22000000, battery_system_v: 48, capacity_ah: 100, voltage_v: 51.2, dod_pct: 90 },
  kabel: { category: "aksesoris", name: "Kabel PV 10 mm", unit: "meter", unit_price: 15000 },
}
export type PartKey = keyof typeof PARTS

// Seed Pengaturan dan status, isi nilai "Diisi tim" dengan angka tes, lalu masukkan semua part contoh.
export async function seedTestData() {
  await seedDefaults(pool)
  await pool.query(`update settings set value = '2000000' where key = 'installation_estimate'`)
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
