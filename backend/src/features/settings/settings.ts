import { Router } from "express"
import { all, one, pool, type Db } from "../../core/db.js"
import { fail, param, v } from "../../core/http.js"

// Pengaturan (PRD bagian 11.3). DEFAULTS adalah nilai awal dari PRD; null berarti "Diisi tim" dan belum diisi.
type Check = (x: unknown) => boolean
const int = (min: number, max = Infinity): Check => x => Number.isInteger(x) && (x as number) >= min && (x as number) <= max
const num = (min: number, max = Infinity): Check => x => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max
const text = (max: number): Check => x => typeof x === "string" && x.trim().length > 0 && x.length <= max
const orNull = (c: Check): Check => x => x === null || c(x)
const obj = (keys: string[], c: Check): Check => x =>
  !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).sort().join() === [...keys].sort().join() && Object.values(x).every(c)

export const SETTINGS = {
  business_name: { value: null, check: orNull(text(255)), public: false },
  whatsapp_number: { value: null, check: orNull(x => typeof x === "string" && /^[1-9]\d{7,14}$/.test(x)), public: true },
  payment_instructions: { value: null, check: orNull(text(5000)), public: false },
  service_area_text: { value: null, check: orNull(text(5000)), public: true },
  // Tarif listrik per daya PLN (VA). Kuncinya sekaligus daftar pilihan daya PLN.
  tariff_per_va: {
    value: { 900: 1500, 1300: 1500, 2200: 1500, 3500: 1500, 4400: 1500, 5500: 1500, 6600: 1500 },
    check: (x: unknown) => !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length > 0
      && Object.entries(x).every(([k, t]) => /^[1-9]\d*$/.test(k) && int(1)(t)),
    public: true,
  },
  sun_hours: { value: 4, check: num(0.1, 12), public: true },
  system_loss_pct: { value: 15, check: num(0, 99), public: true },
  panel_degradation_pct: { value: 0.5, check: num(0, 20), public: true },
  tariff_escalation_pct: { value: 3, check: num(0, 100), public: true },
  work_mode: { value: "SBU", check: (x: unknown) => x === "SBU" || x === "SOL", public: true },
  battery_unlock_soc_pct: { value: 60, check: num(0, 100), public: true },
  day_hours: { value: { start: 8, end: 16 }, check: (x: unknown) => obj(["start", "end"], int(0, 24))(x) && (x as any).start < (x as any).end, public: true },
  analysis_years: { value: 25, check: int(1, 50), public: true },
  inverter_replace_year: { value: 10, check: int(0, 50), public: true },
  battery_replace_year: { value: 0, check: int(0, 50), public: true }, // 0 = tidak dihitung
  day_share_pct: { value: { sepi_siang: 25, seimbang: 40, ramai_siang: 55 }, check: obj(["sepi_siang", "seimbang", "ramai_siang"], num(0, 100)), public: true },
  accessories_estimate_pct: { value: 20, check: num(0, 100), public: true },
  installation_estimate: { value: null, check: orNull(int(0)), public: true },
  price_validity_days: { value: 7, check: int(1, 365), public: false },
  invoice_due_days: { value: 7, check: int(1, 365), public: false },
  labor_rate_per_day: { value: null, check: orNull(int(0)), public: false },
  action_thresholds: {
    value: { planning_days: 7, no_update_days: 3, refund_days: 7, stale_price_days: 30 },
    check: obj(["planning_days", "no_update_days", "refund_days", "stale_price_days"], int(1, 365)), public: false,
  },
  proof_min_finished: { value: 3, check: int(1, 1000), public: false },
} satisfies Record<string, { value: unknown; check: Check; public: boolean }>
export type SettingKey = keyof typeof SETTINGS
export type Settings = { -readonly [K in SettingKey]: (typeof SETTINGS)[K]["value"] | any }

export async function getSettings(db: Db = pool): Promise<Settings> {
  const rows = await all(db, "select key, value from settings")
  const out = Object.fromEntries(rows.map(r => [r.key, r.value]))
  const missing = Object.keys(SETTINGS).filter(k => !(k in out))
  if (missing.length) fail(500, `Pengaturan belum lengkap: ${missing.join(", ")}`, "SETTINGS_MISSING")
  return out as Settings
}
// Nilai "Diisi tim" yang masih kosong tetapi dibutuhkan untuk menghitung.
export const required = <T>(s: Settings, key: SettingKey, label: string): T =>
  s[key] ?? fail(409, `${label} belum diisi tim di Pengaturan`, "SETTING_NOT_FILLED")

export const router = Router()

// Endpoint publik hanya mengirim yang dibutuhkan pengunjung (PRD bagian 11.3).
router.get("/settings/public", async (_req, res) => {
  const s = await getSettings()
  const settings = Object.fromEntries(Object.entries(SETTINGS).filter(([, d]) => d.public).map(([k]) => [k, s[k as SettingKey]]))
  const faqs = await all(pool, "select id, question, answer from faqs where is_active order by sort_order, question")
  res.json({ settings, faqs })
})

router.get("/admin/settings", async (_req, res) => {
  const rows = await all(pool, `select s.key, s.value, s.updated_at, u.name updated_by_name from settings s
    left join users u on u.id = s.updated_by order by s.key`)
  res.json({ settings: rows })
})

router.put("/admin/settings/:key", async (req, res) => {
  const key = req.params.key as SettingKey
  if (!(key in SETTINGS)) fail(404, "Pengaturan tidak dikenal", "NOT_FOUND")
  const value = req.body?.value
  if (value === undefined || !SETTINGS[key].check(value)) fail(400, `Nilai untuk ${key} tidak valid`, "INVALID_INPUT")
  const row = await one(pool, `insert into settings (key, value, updated_by, updated_at) values ($1, $2, $3, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by returning key, value, updated_at`,
    [key, JSON.stringify(value), req.user!.sub])
  res.json({ setting: row })
})

// FAQ di Home (PRD bagian 5.1). Jawaban ditulis tim.
router.get("/admin/faqs", async (_req, res) => {
  res.json({ faqs: await all(pool, "select * from faqs order by sort_order, question") })
})
router.post("/admin/faqs", async (req, res) => {
  const b = req.body ?? {}
  const faq = await one(pool, "insert into faqs (question, answer, sort_order) values ($1, $2, $3) returning *",
    [v.text(b, "question"), v.text(b, "answer"), v.int(b, "sort_order", 0)])
  res.status(201).json({ faq })
})
router.patch("/admin/faqs/:id", async (req, res) => {
  const id = param(req, "id"), b = req.body ?? {}
  const old = await one(pool, "select * from faqs where id = $1", [id]) ?? fail(404, "FAQ tidak ditemukan", "NOT_FOUND")
  const m = { ...old, ...b }
  const faq = await one(pool, "update faqs set question = $2, answer = $3, sort_order = $4, is_active = $5 where id = $1 returning *",
    [id, v.text(m, "question"), v.text(m, "answer"), v.int(m, "sort_order", 0), v.bool(m, "is_active")])
  res.json({ faq })
})

// Status dan sub-status (PRD bagian 9.2). Status bawaan punya kunci sistem: boleh ganti nama, tidak bisa dinonaktifkan.
router.get("/admin/statuses", async (_req, res) => {
  const statuses = await all(pool, `select s.*, coalesce((select json_agg(x order by x.sort_order, x.name) from project_sub_statuses x
    where x.status_id = s.id), '[]') sub_statuses from project_statuses s order by s.sort_order, s.name`)
  res.json({ statuses })
})
router.post("/admin/statuses", async (req, res) => {
  const b = req.body ?? {}
  const status = await one(pool, "insert into project_statuses (name, show_to_client, sort_order) values ($1, $2, $3) returning *",
    [v.str(b, "name"), v.bool(b, "show_to_client"), v.int(b, "sort_order", 0)])
  res.status(201).json({ status })
})
router.patch("/admin/statuses/:id", async (req, res) => {
  const id = param(req, "id"), b = req.body ?? {}
  const old = await one(pool, "select * from project_statuses where id = $1", [id]) ?? fail(404, "Status tidak ditemukan", "NOT_FOUND")
  const m = { ...old, ...b }
  if (old.system_key && m.is_active === false) fail(400, "Status bawaan dipakai logika otomatis dan tidak bisa dinonaktifkan", "SYSTEM_STATUS")
  const status = await one(pool, "update project_statuses set name = $2, show_to_client = $3, sort_order = $4, is_active = $5 where id = $1 returning *",
    [id, v.str(m, "name"), v.bool(m, "show_to_client"), v.int(m, "sort_order", 0), v.bool(m, "is_active")])
  res.json({ status })
})
router.post("/admin/statuses/:id/sub-statuses", async (req, res) => {
  const id = param(req, "id"), b = req.body ?? {}
  if (!(await one(pool, "select 1 from project_statuses where id = $1", [id]))) fail(404, "Status tidak ditemukan", "NOT_FOUND")
  const sub_status = await one(pool, "insert into project_sub_statuses (status_id, name, sort_order) values ($1, $2, $3) returning *",
    [id, v.str(b, "name"), v.int(b, "sort_order", 0)])
  res.status(201).json({ sub_status })
})
router.patch("/admin/sub-statuses/:id", async (req, res) => {
  const id = param(req, "id"), b = req.body ?? {}
  const old = await one(pool, "select * from project_sub_statuses where id = $1", [id]) ?? fail(404, "Sub-status tidak ditemukan", "NOT_FOUND")
  const m = { ...old, ...b }
  const sub_status = await one(pool, "update project_sub_statuses set name = $2, sort_order = $3, is_active = $4 where id = $1 returning *",
    [id, v.str(m, "name"), v.int(m, "sort_order", 0), v.bool(m, "is_active")])
  res.json({ sub_status })
})
