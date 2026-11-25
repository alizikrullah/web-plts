import { Router } from "express"
import { all, one, pool, type Db } from "../../core/db.js"
import { fail, param, v } from "../../core/http.js"

// List Part, satu-satunya sumber part dan harga (PRD bagian 11).
export const CATEGORIES = ["panel", "inverter", "baterai", "aksesoris"] as const
const TIERS = ["hemat", "standar", "premium"] as const
const SYSTEM_TYPES = ["hybrid_offgrid", "on_grid"] as const
const TECH = {
  panel: ["package_tier", "wp", "voc", "vmp", "isc"],
  inverter: ["package_tier", "system_type", "rated_w", "pv_max_w", "pv_voc_max", "mppt_v_min", "mppt_v_max", "pv_current_max", "efficiency_pct", "battery_system_v"],
  baterai: ["package_tier", "battery_system_v", "capacity_ah", "voltage_v", "dod_pct", "cycle_life"],
  aksesoris: ["qty_basis", "qty_per_basis"],
} as const
const ALL_TECH = [...new Set(Object.values(TECH).flat())]
const COLUMNS = ["category", "name", "unit", "unit_price", "store_name", "buy_url", "notes", "is_active", ...ALL_TECH]
// Pengunjung, guest, dan client hanya menerima nama, kategori, harga satuan, kelas paket, angka teknis,
// dan aturan jumlah aksesoris (PRD 11.2 aturan 7).
export const PUBLIC_PART = ["id", "category", "name", "unit", "unit_price", ...ALL_TECH].join(", ")

type Body = Record<string, unknown>
const empty = (b: Body, k: string) => b[k] === undefined || b[k] === null || b[k] === ""
const pct = (b: Body, k: string) => { const x = v.num(b, k, 0); return x > 0 && x <= 100 ? x : fail(400, `${k} harus di atas 0 sampai 100`, "INVALID_INPUT") }
const pos = (b: Body, k: string) => { const x = v.num(b, k); return x > 0 ? x : fail(400, `${k} harus lebih dari 0`, "INVALID_INPUT") }
const optPos = (b: Body, k: string) => (empty(b, k) ? null : pos(b, k))
const posInt = (b: Body, k: string) => v.int(b, k, 1)
const optOne = <T extends string>(b: Body, k: string, list: readonly T[]) => (empty(b, k) ? null : v.oneOf(b, k, list))
const batteryV = (b: Body) => [12, 24, 48].includes(b.battery_system_v as number)
  ? (b.battery_system_v as number) : fail(400, "battery_system_v harus 12, 24, atau 48", "INVALID_INPUT")

// Membaca isian part lengkap. Kolom teknis wajib untuk kategorinya dan dikosongkan untuk kategori lain.
export function readPart(b: Body) {
  const category = v.oneOf(b, "category", CATEGORIES)
  const p: Record<string, unknown> = {
    category, name: v.str(b, "name"), unit: v.str(b, "unit"), unit_price: v.money(b, "unit_price"),
    store_name: v.optStr(b, "store_name"), buy_url: v.optText(b, "buy_url"), notes: v.optText(b, "notes"),
    is_active: b.is_active === undefined ? true : v.bool(b, "is_active"),
  }
  for (const k of ALL_TECH) p[k] = null
  // Kelas paket boleh kosong: part tanpa kelas tidak masuk paket, tetapi tetap bisa dipilih lewat Atur sendiri (PRD 11.1).
  if (category !== "aksesoris") p.package_tier = optOne(b, "package_tier", TIERS)
  if (category === "panel") {
    Object.assign(p, { wp: posInt(b, "wp"), voc: pos(b, "voc"), vmp: pos(b, "vmp"), isc: optPos(b, "isc") })
    if ((p.vmp as number) > (p.voc as number)) fail(400, "Vmp tidak boleh lebih besar dari Voc", "INVALID_INPUT")
  }
  if (category === "inverter") {
    const system_type = v.oneOf(b, "system_type", SYSTEM_TYPES)
    Object.assign(p, {
      system_type, rated_w: posInt(b, "rated_w"), pv_max_w: posInt(b, "pv_max_w"), pv_voc_max: pos(b, "pv_voc_max"),
      mppt_v_min: pos(b, "mppt_v_min"), mppt_v_max: pos(b, "mppt_v_max"), pv_current_max: optPos(b, "pv_current_max"), efficiency_pct: pct(b, "efficiency_pct"),
      battery_system_v: system_type === "on_grid" && (b.battery_system_v ?? null) === null ? null : batteryV(b),
    })
    if ((p.mppt_v_min as number) >= (p.mppt_v_max as number)) fail(400, "Batas bawah MPPT harus lebih kecil dari batas atas", "INVALID_INPUT")
  }
  if (category === "baterai") {
    Object.assign(p, {
      battery_system_v: batteryV(b),
      capacity_ah: pos(b, "capacity_ah"), voltage_v: pos(b, "voltage_v"), dod_pct: pct(b, "dod_pct"),
      cycle_life: empty(b, "cycle_life") ? null : posInt(b, "cycle_life"),
    })
  }
  if (category === "aksesoris") {
    // Aturan jumlah untuk estimasi Simulator (PRD 6.3), berlaku untuk semua jenis sistem. Tanpa aturan, aksesoris hanya dipakai di Planning.
    const qty_basis = optOne(b, "qty_basis", ["per_sistem", "per_string", "per_panel"] as const)
    Object.assign(p, { qty_basis, qty_per_basis: qty_basis ? pos(b, "qty_per_basis") : null })
  }
  return p
}

export async function insertPart(db: Db, p: Record<string, unknown>) {
  const cols = COLUMNS.filter(c => c in p)
  return one(db, `insert into parts (${cols.join(", ")}) values (${cols.map((_, i) => "$" + (i + 1)).join(", ")}) returning *`, cols.map(c => p[c]))
}

export const router = Router()

// Untuk Simulator: panel, inverter, dan baterai yang aktif, ditambah aksesoris aktif yang punya aturan jumlah (PRD 11.2 aturan 2 dan 5).
router.get("/parts", async (_req, res) => {
  res.json({ parts: await all(pool, `select ${PUBLIC_PART} from parts where is_active and (category <> 'aksesoris' or qty_basis is not null) order by category, name`) })
})

router.get("/admin/parts", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : ""
  const category = CATEGORIES.includes(req.query.category as any) ? req.query.category : null
  const active = req.query.active === "true" ? true : req.query.active === "false" ? false : null
  res.json({ parts: await all(pool, `select * from parts where ($1 = '' or name ilike '%' || $1 || '%')
    and ($2::varchar is null or category = $2) and ($3::boolean is null or is_active = $3) order by category, name`, [q, category, active]) })
})

router.get("/admin/parts/:id", async (req, res) => {
  res.json({ part: await one(pool, "select * from parts where id = $1", [param(req, "id")]) ?? fail(404, "Part tidak ditemukan", "NOT_FOUND") })
})

router.post("/admin/parts", async (req, res) => {
  res.status(201).json({ part: await insertPart(pool, readPart(req.body ?? {})) })
})

// Mengubah part. Kategori tidak bisa diganti. Mengirim harga (berubah atau tidak) memperbarui tanggal harga.
router.patch("/admin/parts/:id", async (req, res) => {
  const id = param(req, "id"), b = req.body ?? {}
  const old = await one(pool, "select * from parts where id = $1", [id]) ?? fail(404, "Part tidak ditemukan", "NOT_FOUND")
  if (b.category !== undefined && b.category !== old.category) fail(400, "Kategori part tidak bisa diganti, buat part baru", "INVALID_INPUT")
  const p = readPart({ ...old, ...b, category: old.category })
  const cols = COLUMNS.filter(c => c !== "category")
  const part = await one(pool, `update parts set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}
    ${b.unit_price !== undefined ? ", price_updated_at = now()" : ""} where id = $1 returning *`, [id, ...cols.map(c => p[c])])
  res.json({ part })
})
