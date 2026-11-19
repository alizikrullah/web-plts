import { Router } from "express"
import { one, pool, tx, type Db } from "../../core/db.js"
import { fail, param, v } from "../../core/http.js"
import { planningItems, recalcPlanning, subtotal } from "./planning-core.js"
import { addDaysWib, projectFor, todayWib } from "../projects/projects-core.js"
import { getSettings } from "../settings/settings.js"

// B6: Planning dengan empat kelompok biaya (PRD 7.4).
export const router = Router()
const TYPES = ["part", "sdm", "jasa", "akomodasi"] as const

export async function planningOf(db: Db, projectId: string, lock = false) {
  return (await one(db, `select * from plannings where project_id = $1 ${lock ? "for update" : ""}`, [projectId]))
    ?? fail(404, "Proyek ini belum punya Planning", "NOT_FOUND")
}
// Planning terkunci setelah tagihan awal terbit; terbuka lagi hanya kalau tagihannya dibatalkan (PRD 7.4 aturan 5).
const activeInitialInvoice = (db: Db, projectId: string) =>
  one(db, "select id, number, status from invoices where project_id = $1 and type = 'awal' and status <> 'batal'", [projectId])

router.get("/admin/projects/:id/planning", async (req, res) => {
  const p = await projectFor(pool, req, param(req, "id"))
  const planning = await planningOf(pool, p.id)
  res.json({ planning, items: await planningItems(pool, planning.id), locked: !!(await activeInitialInvoice(pool, p.id)) })
})

// Simpan planning draf. Semua baris dikirim ulang; subtotal dan total dihitung di backend.
router.put("/admin/projects/:id/planning", async (req, res) => {
  const b = req.body ?? {}
  const out = await tx(async c => {
    const p = await projectFor(c, req, param(req, "id"), true)
    const pl = await planningOf(c, p.id, true)
    if (pl.status !== "draf") fail(409, "Planning sudah final. Kembalikan ke draf dulu.", "PLANNING_FINAL")
    if (await activeInitialInvoice(c, p.id)) fail(409, "Tagihan sudah terbit, perubahan biaya dicatat sebagai Biaya Tambahan", "PLANNING_LOCKED")
    const s = await getSettings(c)
    const oldParts = new Set((await planningItems(c, pl.id)).filter(i => i.part_id).map(i => i.part_id))
    const rows = []
    for (const [i, it] of v.array(b, "items").entries()) {
      const type = v.oneOf(it, "type", TYPES)
      let partId: string | null = null, description: string, unit = v.optStr(it, "unit"), unitPrice: number
      let qty = type === "jasa" || type === "akomodasi" ? 1 : v.num(it, "qty")
      if (!(qty > 0)) fail(400, "qty harus lebih dari 0", "INVALID_INPUT")
      let days: number | null = null
      if (type === "part") {
        partId = v.uuid(it, "part_id")
        // part nonaktif tidak bisa dipilih baru, tetapi baris lama yang sudah memakainya tetap boleh
        const part = await one(c, "select * from parts where id = $1 and (is_active or id = any($2))", [partId, [...oldParts]])
          ?? fail(400, "Part tidak ditemukan atau sudah nonaktif", "INVALID_PART")
        description = v.optStr(it, "description") ?? part.name
        unit = unit ?? part.unit
        unitPrice = it.unit_price === undefined ? part.unit_price : v.money(it, "unit_price")
      } else if (type === "sdm") {
        description = v.optStr(it, "description") ?? "Tenaga pasang"
        days = v.num(it, "days")
        if (!(days > 0)) fail(400, "days harus lebih dari 0", "INVALID_INPUT")
        unitPrice = it.unit_price === undefined
          ? (s.labor_rate_per_day ?? fail(409, "Tarif SDM bawaan belum diisi tim di Pengaturan, isi tarif per orang per hari", "SETTING_NOT_FILLED"))
          : v.money(it, "unit_price")
      } else {
        description = v.str(it, "description")
        unitPrice = v.money(it, "unit_price")
      }
      rows.push([pl.id, type, partId, description, unit, qty, days, unitPrice, subtotal(qty, unitPrice, days), i + 1])
    }
    await c.query("delete from planning_items where planning_id = $1", [pl.id])
    for (const r of rows) await c.query(`insert into planning_items (planning_id, type, part_id, description, unit, qty, days, unit_price, subtotal, sort_order)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, r)
    await c.query("update plannings set site_notes = $2 where id = $1", [pl.id, v.optText(b, "site_notes")])
    return { planning: await recalcPlanning(c, pl.id), items: await planningItems(c, pl.id) }
  })
  res.json(out)
})

// Final: tanggal harga berlaku bawaannya hari ini ditambah lama harga berlaku di Pengaturan (PRD 7.4 aturan 3).
router.post("/admin/projects/:id/planning/finalize", async (req, res) => {
  const b = req.body ?? {}
  const planning = await tx(async c => {
    const p = await projectFor(c, req, param(req, "id"), true)
    const pl = await planningOf(c, p.id, true)
    if (pl.status === "final") fail(409, "Planning sudah final", "PLANNING_FINAL")
    if (!(pl.grand_total > 0)) fail(400, "Planning masih kosong", "INVALID_INPUT")
    const until = v.optDate(b, "price_valid_until") ?? await addDaysWib(c, (await getSettings(c)).price_validity_days)
    if (until < await todayWib(c)) fail(400, "Tanggal harga berlaku tidak boleh sebelum hari ini", "INVALID_INPUT")
    return one(c, "update plannings set status = 'final', price_valid_until = $2, finalized_at = now() where id = $1 returning *", [pl.id, until])
  })
  res.json({ planning })
})

// Planning final bisa dikembalikan ke draf selama tagihan belum terbit (PRD 7.4 aturan 4).
router.post("/admin/projects/:id/planning/reopen", async (req, res) => {
  const planning = await tx(async c => {
    const p = await projectFor(c, req, param(req, "id"), true)
    const pl = await planningOf(c, p.id, true)
    if (pl.status === "draf") fail(409, "Planning masih draf", "PLANNING_DRAFT")
    if (await activeInitialInvoice(c, p.id)) fail(409, "Tagihan sudah terbit. Batalkan tagihannya dulu kalau Planning perlu diubah.", "PLANNING_LOCKED")
    return one(c, "update plannings set status = 'draf' where id = $1 returning *", [pl.id])
  })
  res.json({ planning })
})
