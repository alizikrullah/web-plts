import { Router } from "express"
import { all, one, pool, tx, type Db } from "../../core/db.js"
import { saveFile } from "../files/files.js"
import { fail, param, v } from "../../core/http.js"
import { invoicePdf } from "../../core/pdf.js"
import { planningItems } from "../planning/planning-core.js"
import { planningOf } from "../planning/planning.js"
import { addDaysWib, moveTo, nextNumber, projectFor, statusKeyOf } from "../projects/projects-core.js"
import { getSettings, required } from "../settings/settings.js"

// B6: tagihan dengan PDF, pembayaran, dan perpindahan status otomatis (PRD bagian 8).
// Sebelum terbit, admin membuka pratinjau PDF yang persis sama dengan yang diterima client. Pratinjau tidak menyimpan apa pun;
// kalau ada yang salah, Planning dikembalikan ke draf dan diubah di sana (keputusan tim 24 Nov 2026). Status draf tagihan tidak dipakai.
export const router = Router()

export interface Line { type: string; description: string; unit: string | null; qty: number; days: number | null; unit_price: number; subtotal: number }
type Source = { project: any; type: "awal" | "tambahan"; priceValidUntil: string | null; items: Line[] }
const sumOf = (items: Line[], type: string) => items.filter(i => i.type === type).reduce((s, i) => s + i.subtotal, 0)

// Angka dan isi tagihan, dipakai bersama oleh pratinjau dan terbit supaya keduanya pasti sama.
async function invoiceContent(c: Db, o: Source) {
  const s = await getSettings(c)
  // Nama usaha boleh kosong (tim belum punya nama usaha); cara pembayaran wajib karena client harus tahu cara membayar.
  const business = (s.business_name as string | null) ?? null, payment = required<string>(s, "payment_instructions", "Cara pembayaran")
  const amounts = { parts: sumOf(o.items, "part"), labor: sumOf(o.items, "sdm"), services: sumOf(o.items, "jasa"), accommodation: sumOf(o.items, "akomodasi") }
  const total = amounts.parts + amounts.labor + amounts.services + amounts.accommodation
  if (!(total > 0)) fail(400, "Tagihan tidak boleh nol", "INVALID_INPUT")
  const dueDate = await addDaysWib(c, s.invoice_due_days)
  const client = (await one(c, "select name, whatsapp from users where id = $1", [o.project.client_id]))!
  const pdf = (number: string, issuedAt: Date, preview = false) => invoicePdf({ business_name: business, payment_instructions: payment, number, type: o.type,
    issued_at: issuedAt, due_date: dueDate, price_valid_until: o.priceValidUntil, client: { ...client, address: o.project.address, city: o.project.city },
    project: { code: o.project.code, name: o.project.name }, items: o.items, totals: { ...amounts, total }, preview })
  return { amounts, total, dueDate, pdf }
}

export const previewPdf = async (c: Db, o: Source) => (await invoiceContent(c, o)).pdf("", new Date(), true)

// Menerbitkan tagihan: nomor, salinan baris biaya (aturan 18.4), PDF, dan file tagihan.
export async function issueInvoice(c: Db, o: Source & { planningId: string | null; userId: string; notes: string | null }) {
  const { amounts, total, dueDate, pdf } = await invoiceContent(c, o)
  const number = await nextNumber(c, "invoices", "number", "INV")
  const inv = (await one(c, `insert into invoices (project_id, planning_id, type, number, status, issued_at, due_date, price_valid_until,
      amount_parts, amount_labor, amount_services, amount_accommodation, total, notes, created_by)
    values ($1, $2, $3, $4, 'terbit', now(), $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
    [o.project.id, o.planningId, o.type, number, dueDate, o.priceValidUntil, amounts.parts, amounts.labor, amounts.services, amounts.accommodation, total, o.notes, o.userId]))!
  for (const [i, it] of o.items.entries())
    await c.query(`insert into invoice_items (invoice_id, type, description, unit, qty, days, unit_price, subtotal, sort_order)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [inv.id, it.type, it.description, it.unit, it.qty, it.days, it.unit_price, it.subtotal, i + 1])
  const buf = await pdf(number, inv.issued_at)
  const file = (await saveFile(c, { buf, name: `${number}.pdf`, mime: "application/pdf", projectId: o.project.id, purpose: "tagihan_pdf", userId: o.userId }))!
  return (await one(c, "update invoices set pdf_file_id = $2 where id = $1 returning *", [inv.id, file.id]))!
}

export const sendPdf = (res: any, buf: Buffer) => res.type("application/pdf").setHeader("Content-Disposition", 'inline; filename="pratinjau-tagihan.pdf"').send(buf)

// Syarat tagihan awal, sama untuk pratinjau dan terbit.
async function initialSource(c: Db, req: any, lock: boolean) {
  const p = await projectFor(c, req, param(req, "id"), lock)
  if ((await statusKeyOf(c, p)) !== "planning") fail(409, "Tagihan awal hanya bisa dibuat saat proyek berstatus Planning", "INVALID_STATUS")
  const pl = await planningOf(c, p.id, lock)
  if (pl.status !== "final") fail(409, "Tagihan hanya bisa dibuat dari Planning final", "PLANNING_DRAFT")
  if (await one(c, "select 1 from invoices where project_id = $1 and type = 'awal' and status <> 'batal'", [p.id]))
    fail(409, "Proyek ini sudah punya tagihan awal", "INVOICE_EXISTS")
  return { p, pl, source: { project: p, type: "awal" as const, priceValidUntil: pl.price_valid_until, items: await planningItems(c, pl.id) } }
}

router.get("/admin/projects/:id/invoices/preview", async (req, res) => {
  sendPdf(res, await tx(async c => previewPdf(c, (await initialSource(c, req, false)).source)))
})

// Tagihan awal dari Planning final. Status proyek pindah ke Menunggu Pembayaran (PRD 8.1).
router.post("/admin/projects/:id/invoices", async (req, res) => {
  const invoice = await tx(async c => {
    const { p, pl, source } = await initialSource(c, req, true)
    const inv = await issueInvoice(c, { ...source, planningId: pl.id, userId: req.user!.sub, notes: v.optText(req.body ?? {}, "notes") })
    await moveTo(c, p.id, "menunggu_pembayaran", `Tagihan ${inv.number} terbit`, req.user!.sub)
    return inv
  })
  res.status(201).json({ invoice })
})

router.get("/admin/projects/:id/invoices", async (req, res) => {
  const p = await projectFor(pool, req, param(req, "id"))
  const invoices = await all(pool, `select i.*,
      coalesce((select json_agg(x order by x.sort_order) from invoice_items x where x.invoice_id = i.id), '[]') items,
      coalesce((select json_agg(y order by y.paid_at, y.created_at) from payments y where y.invoice_id = i.id), '[]') payments,
      (select coalesce(sum(amount), 0) from payments y where y.invoice_id = i.id)::bigint paid
    from invoices i where i.project_id = $1 order by i.created_at`, [p.id])
  res.json({ invoices })
})

async function invoiceFor(c: Db, req: any, id: string) {
  const inv = await one(c, "select * from invoices where id = $1 for update", [id]) ?? fail(404, "Tagihan tidak ditemukan", "NOT_FOUND")
  return { inv, project: await projectFor(c, req, inv.project_id, true) }
}

// Tagihan yang belum dibayar bisa dibatalkan. Untuk tagihan awal, proyek kembali ke Planning dan Planning bisa diubah lagi (PRD 8.1).
router.post("/admin/invoices/:id/cancel", async (req, res) => {
  const invoice = await tx(async c => {
    const { inv, project } = await invoiceFor(c, req, param(req, "id"))
    if (inv.status !== "terbit") fail(409, "Hanya tagihan terbit yang belum dibayar yang bisa dibatalkan", "INVALID_STATUS")
    if (await one(c, "select 1 from payments where invoice_id = $1", [inv.id])) fail(409, "Tagihan ini sudah ada pembayaran", "HAS_PAYMENT")
    const out = await one(c, "update invoices set status = 'batal' where id = $1 returning *", [inv.id])
    if (inv.type === "awal") {
      await c.query("update plannings set status = 'draf' where id = $1", [inv.planning_id])
      await moveTo(c, project.id, "planning", v.optText(req.body ?? {}, "note") ?? `Tagihan ${inv.number} dibatalkan`, req.user!.sub)
    }
    if (inv.type === "tambahan") await c.query("update cost_adjustments set invoice_id = null where invoice_id = $1", [inv.id])
    return out
  })
  res.json({ invoice })
})

// Catat pembayaran. Saat tagihan awal lunas, proyek pindah ke On Progress dengan sub-status pertama (PRD 8.2).
router.post("/admin/invoices/:id/payments", async (req, res) => {
  const b = req.body ?? {}
  const out = await tx(async c => {
    const { inv, project } = await invoiceFor(c, req, param(req, "id"))
    if (inv.status !== "terbit") fail(409, "Pembayaran hanya untuk tagihan terbit yang belum lunas", "INVALID_STATUS")
    const amount = v.money(b, "amount", 1), proof = v.optUuid(b, "proof_file_id")
    const paid = (await one(c, "select coalesce(sum(amount), 0)::bigint n from payments where invoice_id = $1", [inv.id]))!.n
    if (paid + amount > inv.total) fail(400, `Pembayaran melebihi sisa tagihan Rp${(inv.total - paid).toLocaleString("id-ID")}`, "OVERPAID")
    if (proof && !(await one(c, "select 1 from files where id = $1 and project_id = $2 and purpose = 'bukti_bayar'", [proof, project.id])))
      fail(400, "Bukti bayar harus diunggah ke proyek ini dengan purpose bukti_bayar", "INVALID_INPUT")
    const payment = await one(c, `insert into payments (invoice_id, amount, paid_at, method, proof_file_id, note, recorded_by)
      values ($1, $2, $3, $4, $5, $6, $7) returning *`, [inv.id, amount, v.date(b, "paid_at"), v.str(b, "method"), proof, v.optText(b, "note"), req.user!.sub])
    let invoice = inv
    if (paid + amount === inv.total) {
      invoice = await one(c, "update invoices set status = 'lunas' where id = $1 returning *", [inv.id])
      if (inv.type === "awal") await moveTo(c, project.id, "on_progress", `Tagihan ${inv.number} lunas`, req.user!.sub)
    }
    return { payment, invoice }
  })
  res.status(201).json(out)
})
