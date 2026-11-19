import { Router } from "express"
import { DEF, type Params } from "../../../../shared/calc/rumah.js"
import { arrangement, evaluate, investment, toParams, type Battery, type Config, type Inverter, type Panel, type Pattern, type SimSettings } from "../../../../shared/calc/simulator.js"
import { all, one, pool, type Db } from "../../core/db.js"
import { allow, auth, fail, param, v } from "../../core/http.js"
import { getSettings, required } from "../settings/settings.js"

// B4: simpan simulasi. Backend selalu menghitung ulang dan menyalin harga saat itu (PRD 6.5, aturan 18.4).
export const router = Router()
const PATTERNS = ["sepi_siang", "seimbang", "ramai_siang"] as const
const OVERRIDABLE = Object.keys(DEF).filter(k => !["seri", "paralel", "pDay", "pNight", "tagihan", "wp"].includes(k)) as (keyof Params)[]

export async function simSettings(db: Db): Promise<SimSettings> {
  const s = await getSettings(db)
  return { ...s, installation_estimate: required<number>(s, "installation_estimate", "Estimasi jasa instalasi") } as SimSettings
}

async function activePart<T>(db: Db, id: string, category: string, label: string) {
  return (await one<T>(db, "select * from parts where id = $1 and category = $2 and is_active", [id, category]))
    ?? fail(400, `${label} tidak ditemukan atau sudah nonaktif`, "INVALID_PART")
}

// Membaca isian simulasi dan menyusun konfigurasi. Mode lengkap (pola manual, susunan, dan angka yang ditimpa) hanya untuk admin.
export async function readConfig(db: Db, b: Record<string, unknown>, isAdmin: boolean, s: SimSettings): Promise<Config> {
  const systemType = v.oneOf(b, "system_type", ["hybrid_offgrid", "on_grid"] as const)
  if (systemType === "on_grid") fail(400, "Perhitungan on-grid belum tersedia, silakan hubungi kami lewat WhatsApp", "ON_GRID")
  const pln = v.int(b, "pln_power_va", 1)
  if (!(String(pln) in s.tariff_per_va)) fail(400, "Daya PLN tidak ada di pilihan", "INVALID_INPUT")
  const pattern = v.oneOf(b, "usage_pattern", isAdmin ? [...PATTERNS, "manual"] as const : PATTERNS)
  const bill = v.money(b, "monthly_bill", pattern === "manual" ? 0 : 1)
  const panel = await activePart<Panel>(db, v.uuid(b, "panel_part_id"), "panel", "Panel")
  const inverter = await activePart<Inverter>(db, v.uuid(b, "inverter_part_id"), "inverter", "Inverter")
  if (inverter.system_type !== "hybrid_offgrid") fail(400, "Inverter harus berjenis hybrid atau off-grid", "INVALID_PART")
  const batteryId = v.optUuid(b, "battery_part_id")
  const battery = batteryId ? await activePart<Battery>(db, batteryId, "baterai", "Baterai") : null
  // Baterai cocok dengan inverter kalau kelas tegangannya sama (PRD 11.1).
  if (battery && battery.battery_system_v !== inverter.battery_system_v)
    fail(400, `Baterai ${battery.battery_system_v} V tidak cocok dengan inverter ${inverter.battery_system_v} V`, "BATTERY_MISMATCH")
  const batteryQty = battery ? v.int(b, "battery_qty", 1) : 0
  const qty = v.int(b, "panel_qty", 1)

  const full = isAdmin && (b.panel_series !== undefined || b.overrides !== undefined || pattern === "manual")
  if (!isAdmin && (b.panel_series !== undefined || b.panel_parallel !== undefined || b.overrides !== undefined))
    fail(403, "Mode lengkap hanya untuk admin", "FORBIDDEN")
  let series: number, parallel: number
  if (isAdmin && b.panel_series !== undefined) {
    series = v.int(b, "panel_series", 1); parallel = v.int(b, "panel_parallel", 1)
    if (series * parallel !== qty) fail(400, "Jumlah panel harus sama dengan seri × paralel", "INVALID_INPUT")
  } else {
    const a = arrangement(panel, inverter, qty) ?? fail(400, "Jumlah panel ini tidak bisa dibagi rata ke string inverter atau melebihi batas inverter", "INVALID_ARRANGEMENT")
    series = a.series; parallel = a.parallel
  }
  const overrides: Partial<Params> = {}
  if (full && b.overrides !== undefined) {
    const o = b.overrides as Record<string, unknown>
    if (!o || typeof o !== "object" || Array.isArray(o)) fail(400, "overrides tidak valid", "INVALID_INPUT")
    for (const [k, x] of Object.entries(o)) {
      if (!OVERRIDABLE.includes(k as keyof Params)) fail(400, `overrides.${k} tidak dikenal`, "INVALID_INPUT")
      if (k === "mode") { if (x !== "SBU" && x !== "SOL") fail(400, "overrides.mode harus SBU atau SOL", "INVALID_INPUT") }
      else if (typeof x !== "number" || !Number.isFinite(x) || x < 0) fail(400, `overrides.${k} harus angka tidak negatif`, "INVALID_INPUT")
      ;(overrides as any)[k] = x
    }
  }
  return {
    pln_power_va: pln, monthly_bill: bill, usage_pattern: pattern, panel, panel_qty: qty, panel_series: series, panel_parallel: parallel,
    inverter, battery, battery_qty: batteryQty, overrides,
    ...(pattern === "manual" && { day_load_kw: v.num(b, "day_load_kw", 0), night_load_kw: v.num(b, "night_load_kw", 0) }),
  }
}

const pick = (o: Record<string, any>, keys: string[]) => Object.fromEntries(keys.map(k => [k, o[k]]))
export async function saveSimulation(db: Db, userId: string, c: Config, s: SimSettings) {
  const p = toParams(c, s), e = evaluate(p), inv = investment(c.panel, c.panel_qty, c.inverter, c.battery, c.battery_qty, s)
  // Salinan nama, angka teknis, dan harga part saat ini, supaya perubahan harga nanti tidak mengubah simulasi ini.
  const snapshot = {
    panel: pick(c.panel, ["id", "name", "unit_price", "wp", "voc", "vmp"]),
    inverter: pick(c.inverter, ["id", "name", "unit_price", "system_type", "rated_w", "pv_max_w", "pv_voc_max", "mppt_v_min", "mppt_v_max", "efficiency_pct", "battery_system_v"]),
    battery: c.battery && pick(c.battery, ["id", "name", "unit_price", "battery_system_v", "capacity_ah", "voltage_v", "dod_pct"]),
    components_total: inv.components, accessories_pct: s.accessories_estimate_pct, accessories_estimate: inv.accessories,
    installation_estimate: inv.installation,
  }
  const params = { ...p, day_share_pct: c.usage_pattern === "manual" ? null : s.day_share_pct[c.usage_pattern as Pattern], overrides: c.overrides ?? {} }
  const row = await one(db, `insert into simulations (user_id, system_type, panel_part_id, panel_qty, panel_series, panel_parallel, inverter_part_id,
    battery_part_id, battery_qty, pln_power_va, monthly_bill, usage_pattern, day_load_kw, night_load_kw, params, snapshot, est_investment,
    capacity_kwp, daily_production_kwh, daily_saved_kwh, monthly_saving, net_profit, bep_years)
    values ($1, 'hybrid_offgrid', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) returning *`,
    [userId, c.panel.id, c.panel_qty, c.panel_series, c.panel_parallel, c.inverter.id, c.battery?.id ?? null, c.battery_qty,
      c.pln_power_va, c.monthly_bill, c.usage_pattern, p.pDay, p.pNight, JSON.stringify(params), JSON.stringify(snapshot),
      e.result.est_investment, e.result.capacity_kwp, e.result.daily_production_kwh, e.result.daily_saved_kwh,
      e.result.monthly_saving, e.result.net_profit, e.result.bep_years])
  return withAdvice(row)
}

// Saran dihitung ulang dari isian yang tersimpan; angka hasil tetap memakai yang tersimpan.
export function withAdvice(sim: any) {
  const e = evaluate(sim.params as Params)
  return { ...sim, tips: e.tips, danger: e.danger, pv_used_pct: e.pv_used_pct }
}

router.post("/simulations", auth, allow("guest", "client", "admin"), async (req, res) => {
  const s = await simSettings(pool)
  const c = await readConfig(pool, req.body ?? {}, req.user!.role === "admin", s)
  res.status(201).json({ simulation: await saveSimulation(pool, req.user!.sub, c, s) })
})

router.get("/simulations", auth, allow("guest", "client", "admin"), async (req, res) => {
  res.json({ simulations: await all(pool, "select * from simulations where user_id = $1 order by created_at desc", [req.user!.sub]) })
})

router.get("/simulations/:id", auth, allow("guest", "client", "admin"), async (req, res) => {
  const sim = await one(pool, "select * from simulations where id = $1 and ($2 or user_id = $3)",
    [param(req, "id"), req.user!.role === "admin", req.user!.sub]) ?? fail(404, "Simulasi tidak ditemukan", "NOT_FOUND")
  res.json({ simulation: withAdvice(sim) })
})
