import { Router } from "express"
import { all, one, pool, tx, type Db } from "../../core/db.js"
import { fail, param, v } from "../../core/http.js"
import { readInvoice, type Extraction } from "./invoice-reader.js"
import { issueInvoice } from "../invoices/invoices.js"
import { mergePdf } from "../../core/pdf.js"
import { projectFor, recap } from "../projects/projects-core.js"
import { getFile } from "../../core/storage.js"

// B7: Gabungan Invoice Pembelian, Biaya Tambahan, rekap akhir, dan pengembalian (PRD bagian 8 dan 10).
export const router = Router()
const GROUPS = ["komponen_utama", "aksesoris"] as const
const MONEY = ["subtotal_products", "discount", "shipping", "shipping_discount", "other_fees", "total_paid"] as const

// Pengecekan jumlah (PRD 10.2). Nota tulisan tangan cukup pengecekan kedua; tanpa nota tidak dicek.
export function checkPurchase(p: Record<string, any>, items: { qty: number; unit_price: number }[]) {
  if (p.document_type === "tanpa_nota") return null
  const lines = items.reduce((s, i) => s + Math.round(i.qty * i.unit_price), 0)
  if (p.document_type === "nota") return lines === p.total_paid
  const total = p.subtotal_products - p.discount + p.shipping - p.shipping_discount + p.other_fees
  return total === p.total_paid && lines === p.subtotal_products
}

type Body = Record<string, unknown>
function readItems(b: Body) {
  if (b.items === undefined) return []
  return v.array(b, "items").map(it => {
    const qty = v.num(it, "qty")
    if (!(qty > 0)) fail(400, "qty barang harus lebih dari 0", "INVALID_INPUT")
    const unit_price = v.money(it, "unit_price")
    return { name: v.str(it, "name"), unit: v.optStr(it, "unit"), qty, unit_price, subtotal: Math.round(qty * unit_price), part_id: v.optUuid(it, "part_id") }
  })
}
function readHeader(b: Body) {
  const h: Record<string, unknown> = {
    item_group: b.item_group === undefined || b.item_group === null ? null : v.oneOf(b, "item_group", GROUPS),
    store_name: v.optStr(b, "store_name"), purchase_date: v.optDate(b, "purchase_date"), invoice_number: v.optStr(b, "invoice_number"),
  }
  for (const k of MONEY) h[k] = b[k] === undefined || b[k] === null ? 0 : v.money(b, k)
  return h
}
async function saveItems(c: Db, purchaseId: string, items: ReturnType<typeof readItems>) {
  for (const it of items) if (it.part_id && !(await one(c, "select 1 from parts where id = $1", [it.part_id]))) fail(400, "Part tidak ditemukan", "INVALID_PART")
  await c.query("delete from purchase_items where purchase_id = $1", [purchaseId])
  for (const [i, it] of items.entries())
    await c.query(`insert into purchase_items (purchase_id, part_id, name, unit, qty, unit_price, subtotal, sort_order) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [purchaseId, it.part_id, it.name, it.unit, it.qty, it.unit_price, it.subtotal, i + 1])
}
const withItems = (where: string) => `select x.*, coalesce((select json_agg(i order by i.sort_order) from purchase_items i where i.purchase_id = x.id), '[]') items
  from purchases x ${where}`

// Satu file per pembelian. File asli langsung tersimpan; isi dibaca modul pembaca kalau ada, kalau tidak diisi manual.
// Hasilnya selalu draf (PRD 10.1).
router.post("/admin/projects/:id/purchases", async (req, res) => {
  const b = req.body ?? {}
  const purchase = await tx(async c => {
    const p = await projectFor(c, req, param(req, "id"), true)
    const document_type = v.oneOf(b, "document_type", ["invoice", "nota", "tanpa_nota"] as const)
    const fileId = document_type === "tanpa_nota" ? null : v.uuid(b, "file_id")
    let extracted: Extraction | null = null
    if (fileId) {
      const file = await one(c, "select * from files where id = $1 and project_id = $2 and purpose = 'invoice_pembelian'", [fileId, p.id])
        ?? fail(400, "File harus diunggah ke proyek ini dengan purpose invoice_pembelian", "INVALID_INPUT")
      if (await one(c, "select 1 from purchases where file_id = $1", [fileId])) fail(409, "File ini sudah dipakai pembelian lain", "INVALID_INPUT")
      extracted = await readInvoice({ buf: await getFile(file.storage_key), mime: file.mime_type, name: file.original_name })
    }
    const src: Body = extracted ? { ...extracted, ...b } : b
    const h = readHeader(src), items = readItems(src)
    const row = (await one(c, `insert into purchases (project_id, item_group, store_name, purchase_date, invoice_number, document_type, file_id,
        subtotal_products, discount, shipping, shipping_discount, other_fees, total_paid, check_passed, extraction_raw, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning *`,
      [p.id, h.item_group, h.store_name, h.purchase_date, h.invoice_number, document_type, fileId, h.subtotal_products, h.discount, h.shipping,
        h.shipping_discount, h.other_fees, h.total_paid, checkPurchase({ ...h, document_type }, items), extracted && JSON.stringify(extracted.raw), req.user!.sub]))!
    await saveItems(c, row.id, items)
    return one(c, withItems("where x.id = $1"), [row.id])
  })
  res.status(201).json({ purchase })
})

async function draftFor(c: Db, req: any, id: string) {
  const x = await one(c, "select * from purchases where id = $1 for update", [id]) ?? fail(404, "Pembelian tidak ditemukan", "NOT_FOUND")
  await projectFor(c, req, x.project_id)
  if (x.status !== "draf") fail(409, "Pembelian sudah terkonfirmasi dan tidak bisa diubah", "CONFIRMED")
  return x
}

// Koreksi draf oleh admin. Pengecekan jumlah dihitung ulang.
router.patch("/admin/purchases/:id", async (req, res) => {
  const b = req.body ?? {}
  const purchase = await tx(async c => {
    const x = await draftFor(c, req, param(req, "id"))
    const cur = { ...x, items: (await all(c, "select * from purchase_items where purchase_id = $1 order by sort_order", [x.id])) }
    const m = { ...cur, ...b }
    const h = readHeader(m), items = readItems(m)
    await c.query(`update purchases set item_group = $2, store_name = $3, purchase_date = $4, invoice_number = $5, subtotal_products = $6, discount = $7,
      shipping = $8, shipping_discount = $9, other_fees = $10, total_paid = $11, check_passed = $12 where id = $1`,
      [x.id, h.item_group, h.store_name, h.purchase_date, h.invoice_number, h.subtotal_products, h.discount, h.shipping, h.shipping_discount,
        h.other_fees, h.total_paid, checkPurchase({ ...h, document_type: x.document_type }, items)])
    await saveItems(c, x.id, items)
    return one(c, withItems("where x.id = $1"), [x.id])
  })
  res.json({ purchase })
})

// Konfirmasi: hanya pembelian terkonfirmasi yang tampil ke client dan masuk rekap (aturan 18.7).
// Kalau belanja aktual melewati tagihan part, peringatannya langsung muncul (PRD 8.3 aturan 1).
router.post("/admin/purchases/:id/confirm", async (req, res) => {
  const out = await tx(async c => {
    const x = await draftFor(c, req, param(req, "id"))
    const items = await all(c, "select * from purchase_items where purchase_id = $1", [x.id])
    const missing = [!x.item_group && "kelompok", !x.store_name && "toko", !x.purchase_date && "tanggal", !items.length && "barang",
      items.some(i => !i.unit) && "satuan barang"].filter(Boolean)
    if (missing.length) fail(400, `Lengkapi dulu: ${missing.join(", ")}`, "INCOMPLETE")
    const purchase = await one(c, "update purchases set status = 'terkonfirmasi', confirmed_by = $2, confirmed_at = now() where id = $1 returning *", [x.id, req.user!.sub])
    const r = await recap(c, x.project_id)
    return { purchase, recap: r, ...(r.shortfall > 0 && { warning: `Belanja aktual melewati tagihan part Rp${r.shortfall.toLocaleString("id-ID")}. Catat sebagai Biaya Tambahan.` }) }
  })
  res.json(out)
})

router.get("/admin/projects/:id/purchases", async (req, res) => {
  const p = await projectFor(pool, req, param(req, "id"))
  res.json({ purchases: await all(pool, withItems("where x.project_id = $1 order by x.purchase_date nulls first, x.created_at"), [p.id]), recap: await recap(pool, p.id) })
})

// Halaman Invoice Pembelian untuk client: meniru sheet "Rincian Belanja" ditambah rekap akhir (PRD 10.3 dan 8.4).
const NOTE = { invoice: "Invoice terlampir", nota: "Nota terlampir", tanpa_nota: "Tidak ada nota" } as Record<string, string>
router.get("/projects/:id/purchases", async (req, res) => {
  const p = await projectFor(pool, req, param(req, "id"))
  const confirmed = await all(pool, withItems("where x.project_id = $1 and x.status = 'terkonfirmasi' order by x.purchase_date, x.confirmed_at"), [p.id])
  const groups = GROUPS.map(g => {
    const rows = confirmed.filter(x => x.item_group === g).map(x => ({
      id: x.id, items: x.items.map((i: any) => ({ name: i.name, unit: i.unit, qty: i.qty, unit_price: i.unit_price })),
      total_paid: x.total_paid, store_name: x.store_name, purchase_date: x.purchase_date, note: NOTE[x.document_type], file_id: x.file_id,
    }))
    return { group: g, label: g === "komponen_utama" ? "Komponen Utama" : "Aksesoris", purchases: rows, subtotal: rows.reduce((s, r) => s + r.total_paid, 0) }
  })
  const r = await recap(pool, p.id)
  res.json({
    groups, total: groups.reduce((s, g) => s + g.subtotal, 0),
    recap: { a_billed_parts: r.a, b_extra_parts_by_client: r.b, c_actual_spend: r.c, d_borne_by_us: r.d, refund_due: r.refund_due,
      refunded: r.refunded, shortfall_undecided: r.shortfall },
    part_adjustments: await all(pool, `select amount, explanation, reason, borne_by, client_approved_at from cost_adjustments
      where project_id = $1 and category = 'part' order by created_at`, [p.id]),
    refunds: await all(pool, "select amount, refunded_at, method, proof_file_id from refunds where project_id = $1 order by refunded_at", [p.id]),
  })
})

router.get("/projects/:id/purchases/gabungan.pdf", async (req, res) => {
  const p = await projectFor(pool, req, param(req, "id"))
  const files = await all(pool, `select f.storage_key, f.mime_type, f.original_name from purchases x join files f on f.id = x.file_id
    where x.project_id = $1 and x.status = 'terkonfirmasi' order by x.purchase_date, x.confirmed_at`, [p.id])
  const buf = await mergePdf(await Promise.all(files.map(async f => ({ buf: await getFile(f.storage_key), mime: f.mime_type, name: f.original_name }))))
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `inline; filename="${p.code}-invoice-pembelian.pdf"`)
  res.setHeader("Cache-Control", "private, no-store")
  res.send(buf)
})

// ---------- Biaya Tambahan (PRD 8.3) ----------

const proofOk = async (c: Db, fileId: string | null, projectId: string, purpose: string) => {
  if (fileId && !(await one(c, "select 1 from files where id = $1 and project_id = $2 and purpose = $3", [fileId, projectId, purpose])))
    fail(400, `Bukti harus diunggah ke proyek ini dengan purpose ${purpose}`, "INVALID_INPUT")
}

router.get("/admin/projects/:id/cost-adjustments", async (req, res) => {
  const p = await projectFor(pool, req, param(req, "id"))
  res.json({ cost_adjustments: await all(pool, "select * from cost_adjustments where project_id = $1 order by created_at", [p.id]) })
})

router.post("/admin/projects/:id/cost-adjustments", async (req, res) => {
  const b = req.body ?? {}
  const p = await projectFor(pool, req, param(req, "id"))
  const proof = v.optUuid(b, "proof_file_id")
  await proofOk(pool, proof, p.id, "bukti_setuju")
  const row = await one(pool, `insert into cost_adjustments (project_id, category, amount, reason, explanation, borne_by, client_approved_at, proof_file_id, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`, [p.id, v.oneOf(b, "category", ["part", "sdm", "jasa", "akomodasi"] as const),
    v.money(b, "amount", 1), v.oneOf(b, "reason", ["kesalahan_kami", "kondisi_lokasi", "kenaikan_harga", "lainnya"] as const), v.text(b, "explanation"),
    v.oneOf(b, "borne_by", ["kami", "client"] as const), v.optDate(b, "client_approved_at"), proof, req.user!.sub])
  res.status(201).json({ cost_adjustment: row })
})

// Bukti setuju client boleh diisi belakangan (PRD 8.3).
router.patch("/admin/cost-adjustments/:id", async (req, res) => {
  const b = req.body ?? {}
  const row = await tx(async c => {
    const x = await one(c, "select * from cost_adjustments where id = $1 for update", [param(req, "id")]) ?? fail(404, "Biaya Tambahan tidak ditemukan", "NOT_FOUND")
    await projectFor(c, req, x.project_id)
    if (x.invoice_id) fail(409, "Biaya Tambahan ini sudah ditagihkan", "INVOICED")
    const m = { ...x, ...b }
    const proof = v.optUuid(m, "proof_file_id")
    await proofOk(c, proof, x.project_id, "bukti_setuju")
    return one(c, "update cost_adjustments set client_approved_at = $2, proof_file_id = $3, explanation = $4 where id = $1 returning *",
      [x.id, v.optDate(m, "client_approved_at"), proof, v.text(m, "explanation")])
  })
  res.json({ cost_adjustment: row })
})

// Tagihan tambahan hanya untuk biaya tanggungan client yang bukti setujunya sudah terisi (PRD 8.3 aturan 2, aturan 18.9).
router.post("/admin/projects/:id/invoices/tambahan", async (req, res) => {
  const b = req.body ?? {}
  const invoice = await tx(async c => {
    const p = await projectFor(c, req, param(req, "id"), true)
    const raw = b.cost_adjustment_ids
    if (!Array.isArray(raw) || !raw.length) fail(400, "Pilih Biaya Tambahan yang akan ditagihkan", "INVALID_INPUT")
    const ids = [...new Set((raw as unknown[]).map(id => v.uuid({ cost_adjustment_ids: id }, "cost_adjustment_ids")))]
    const rows = await all(c, "select * from cost_adjustments where id = any($1) and project_id = $2 for update", [ids, p.id])
    if (rows.length !== ids.length) fail(404, "Biaya Tambahan tidak ditemukan", "NOT_FOUND")
    for (const x of rows) {
      if (x.borne_by !== "client") fail(400, "Biaya yang ditanggung kami cukup dicatat, tanpa tagihan", "BORNE_BY_US")
      if (!x.client_approved_at || !x.proof_file_id) fail(400, "Bukti setuju client (tanggal dan file) wajib ada sebelum tagihan tambahan dibuat", "NO_APPROVAL")
      if (x.invoice_id) fail(409, "Biaya Tambahan ini sudah ditagihkan", "INVOICED")
    }
    const LABEL: Record<string, string> = { kesalahan_kami: "kesalahan kami", kondisi_lokasi: "kondisi lokasi", kenaikan_harga: "kenaikan harga", lainnya: "lainnya" }
    const inv = await issueInvoice(c, { project: p, type: "tambahan", planningId: null, priceValidUntil: null, userId: req.user!.sub, notes: v.optText(b, "notes"),
      items: rows.map(x => ({ type: x.category, description: `${x.explanation} (${LABEL[x.reason]})`.slice(0, 255), unit: null, qty: 1, days: null, unit_price: x.amount, subtotal: x.amount })) })
    await c.query("update cost_adjustments set invoice_id = $2 where id = any($1)", [ids, inv.id])
    return inv
  })
  res.status(201).json({ invoice })
})

// ---------- Pengembalian (PRD 8.4) ----------

router.post("/admin/projects/:id/refunds", async (req, res) => {
  const b = req.body ?? {}
  const refund = await tx(async c => {
    const p = await projectFor(c, req, param(req, "id"), true)
    const amount = v.money(b, "amount", 1), proof = v.optUuid(b, "proof_file_id")
    const r = await recap(c, p.id)
    if (amount > r.refund_remaining) fail(400, `Pengembalian melebihi sisa yang harus dikembalikan Rp${Math.max(0, r.refund_remaining).toLocaleString("id-ID")}`, "OVER_REFUND")
    await proofOk(c, proof, p.id, "bukti_pengembalian")
    return one(c, `insert into refunds (project_id, amount, refunded_at, method, proof_file_id, note, recorded_by) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [p.id, amount, v.date(b, "refunded_at"), v.str(b, "method"), proof, v.optText(b, "note"), req.user!.sub])
  })
  res.status(201).json({ refund })
})
