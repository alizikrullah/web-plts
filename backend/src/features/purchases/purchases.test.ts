import { PDFDocument, StandardFonts } from "pdf-lib"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { one, pool } from "../../core/db.js"
import { flow, PNG } from "../../test/flow.js"
import { seedTestData, type PartKey } from "../../test/test-data.js"
import { client, freshTestDb, startApp, userSession, type Session } from "../../test/test-db.js"

let app: Awaited<ReturnType<typeof startApp>>, call: ReturnType<typeof client>, admin: Session, ids: Record<PartKey, string>, f: ReturnType<typeof flow>
let pdfBuf: Buffer
beforeAll(async () => {
  await freshTestDb(); ids = await seedTestData()
  app = await startApp(); call = client(app.base); admin = await userSession(call, "admin"); f = flow(call, admin, ids)
  const d = await PDFDocument.create(); d.addPage([200, 200]); pdfBuf = Buffer.from(await d.save())
})
afterAll(async () => { await app.close(); await pool.end() })

const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const ok = async (r: Promise<{ status: number; json: any }>) => { const x = await r; if (x.status >= 300) throw new Error(`${x.status} ${JSON.stringify(x.json)}`); return x.json }
// Proyek On Progress dengan tagihan part persis Rp23.000.000, seperti contoh di PRD 8.4.
async function project23() {
  const a = await f.accepted()
  await ok(call("PUT", `/api/admin/projects/${a.project.id}/planning`, { as: admin, body: { items: [
    { type: "part", part_id: ids.panel550, qty: 1, unit_price: 23000000 }, { type: "jasa", description: "Instalasi", unit_price: 3000000 }] } }))
  await ok(call("POST", `/api/admin/projects/${a.project.id}/planning/finalize`, { as: admin, body: {} }))
  const invoice = await f.issue(a.project.id)
  await f.pay(invoice.id, invoice.total)
  return { ...a, invoice }
}
// Pembelian terkonfirmasi senilai total tertentu.
async function buy(projectId: string, total: number, o: { group?: string; file?: Buffer; type?: string; confirm?: boolean } = {}) {
  const file = await f.upload(projectId, "invoice_pembelian", o.file ?? pdfBuf, o.type ?? "application/pdf", "invoice.pdf")
  const x = (await ok(call("POST", `/api/admin/projects/${projectId}/purchases`, { as: admin, body: { document_type: "invoice", file_id: file.id,
    item_group: o.group ?? "komponen_utama", store_name: "Toko Surya", purchase_date: today(), subtotal_products: total, total_paid: total,
    items: [{ name: "Barang", unit: "unit", qty: 1, unit_price: total }] } }))).purchase
  if (o.confirm !== false) await ok(call("POST", `/api/admin/purchases/${x.id}/confirm`, { as: admin }))
  return { ...x, file }
}
const adjust = (projectId: string, body: Record<string, unknown>) => ok(call("POST", `/api/admin/projects/${projectId}/cost-adjustments`, { as: admin,
  body: { category: "part", reason: "kenaikan_harga", explanation: "Harga inverter naik", ...body } })).then(j => j.cost_adjustment)
const finish = async (projectId: string) => call("POST", `/api/admin/projects/${projectId}/status-updates`, { as: admin,
  body: { status_id: (await one(pool, "select id from project_statuses where system_key = 'selesai'"))!.id, note: "Pekerjaan selesai" } })

// Layanan Groq diganti tiruan: yang diperiksa adalah isi kiriman ke Groq dan cara jawabannya diolah menjadi draf.
const realFetch = globalThis.fetch
function fakeGroq(reply: () => Response) {
  const sent: any[] = []
  vi.stubEnv("GROQ_API_KEY", "kunci-tes")
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    if (!String(url).startsWith("https://api.groq.com/")) return realFetch(url, init)
    sent.push(JSON.parse(init.body))
    return reply()
  })
  return sent
}
const answer = (x: unknown) => () => Response.json({ choices: [{ message: { content: JSON.stringify(x) } }] })
const imagesSent = (req: any): string[] => req.messages[0].content.filter((c: any) => c.type === "image_url").map((c: any) => c.image_url.url)
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe("B7 skenario uji", () => {
  it("skenario 10: invoice toko online diunggah, draf berisi barang dan total yang benar, pengecekan jumlah lolos", async () => {
    const { project } = await f.onProgress()
    const purchase = async (file: { id: string }, body: Record<string, unknown> = {}) =>
      (await ok(call("POST", `/api/admin/projects/${project.id}/purchases`, { as: admin, body: { document_type: "invoice", file_id: file.id, ...body } }))).purchase
    // Invoice toko online dua halaman (struk pesanan dan struk pengiriman), seperti contoh dari tim.
    const d = await PDFDocument.create(), font = await d.embedFont(StandardFonts.Helvetica)
    for (const t of ["ORDER RECEIPT 586742390864709178", "SHIPPING RECEIPT"]) d.addPage([300, 400]).drawText(t, { x: 20, y: 360, size: 10, font })
    const pdf = await f.upload(project.id, "invoice_pembelian", Buffer.from(await d.save()), "application/pdf", "Invoice_Kabel.pdf")
    const reply = { store_name: "rpvsurya", purchase_date: "2026-10-23", invoice_number: "586742390864709178",
      items: [{ name: "Kabel Solar Panel Surya PV 1x10mm - Merah", qty: 20, unit: null, unit_price: 47440, line_total: 948800 },
        { name: "Mc4 connector 10mm", qty: "4", unit: null, unit_price: "Rp27.600", line_total: "Rp110.400" }],
      subtotal_products: 1059200, discount: "-Rp100.400", shipping: 20000, shipping_discount: -20000, other_fees: 12200, total_paid: 971000 }
    const sent = fakeGroq(answer(reply))
    const r = await purchase(pdf, { item_group: "aksesoris" })
    // Tiap halaman PDF dirender menjadi PNG dua kali ukuran halaman, lalu dikirim dalam satu permintaan.
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ model: "qwen/qwen3.8-27b", response_format: { type: "json_object" } })
    const pages = imagesSent(sent[0]).map(u => Buffer.from(u.replace("data:image/png;base64,", ""), "base64"))
    expect(pages.map(p => [p.subarray(1, 4).toString(), p.readUInt32BE(16), p.readUInt32BE(20)])).toEqual([["PNG", 600, 800], ["PNG", 600, 800]])
    expect(r).toMatchObject({ status: "draf", check_passed: true, item_group: "aksesoris", store_name: "rpvsurya", purchase_date: "2026-10-23",
      invoice_number: "586742390864709178", subtotal_products: 1059200, discount: 100400, shipping: 20000, shipping_discount: 20000,
      other_fees: 12200, total_paid: 971000, extraction_raw: reply })
    expect(r.items.map((i: any) => [i.name, i.qty, i.unit_price, i.subtotal])).toEqual([
      ["Kabel Solar Panel Surya PV 1x10mm - Merah", 20, 47440, 948800], ["Mc4 connector 10mm", 4, 27600, 110400]])

    // Foto nota tulisan tangan dikirim apa adanya. Baris tanpa harga satuan dihitung dari jumlah dibagi banyaknya.
    const photo = await f.upload(project.id, "invoice_pembelian", PNG, "image/png", "nota.png")
    const sent2 = fakeGroq(answer({ store_name: "Toko Bintang", purchase_date: "2025-10-31", invoice_number: null, items: [
      { name: "Box Panel Indor 20x30", qty: 1, unit: "pcs", unit_price: null, line_total: 130000 },
      { name: "Skun 50 mm", qty: 8, unit: "pcs", unit_price: 9500, line_total: 76000 },
      { name: "Rel MCB", qty: 1, unit: "btg", unit_price: "-", line_total: 25000 }], subtotal_products: 231000, total_paid: 231000 }))
    const nota = await purchase(photo, { document_type: "nota" })
    expect(imagesSent(sent2[0])).toEqual([`data:image/png;base64,${PNG.toString("base64")}`])
    expect(nota).toMatchObject({ check_passed: true, store_name: "Toko Bintang", purchase_date: "2025-10-31", invoice_number: null, total_paid: 231000 })
    expect(nota.items.map((i: any) => [i.unit, i.qty, i.unit_price, i.subtotal])).toEqual([["pcs", 1, 130000, 130000], ["pcs", 8, 9500, 76000], ["btg", 1, 25000, 25000]])
  })

  it("pengecekan jumlah PRD 10.2 untuk isi manual, dan pembacaan yang gagal tetap menghasilkan draf untuk diisi manual", async () => {
    const { project } = await f.onProgress()
    const post = async (body: Record<string, unknown>, buf = pdfBuf, type = "application/pdf") => {
      const file = await f.upload(project.id, "invoice_pembelian", buf, type, "invoice")
      return (await ok(call("POST", `/api/admin/projects/${project.id}/purchases`, { as: admin, body: { document_type: "invoice", file_id: file.id, ...body } }))).purchase
    }
    // Tanpa GROQ_API_KEY: isi manual
    const body = { store_name: "Toko Online Surya", purchase_date: today(), invoice_number: "INV/20261115/001",
      items: [{ name: "MC4 Connector", unit: "pasang", qty: 4, unit_price: 25000 }, { name: "Kabel PV 10 mm", unit: "meter", qty: 20.5, unit_price: 15000 }],
      subtotal_products: 407500, discount: 7500, shipping: 30000, shipping_discount: 10000, other_fees: 1000, total_paid: 421000 }
    const r = await post(body)
    expect(r).toMatchObject({ status: "draf", check_passed: true, total_paid: 421000, extraction_raw: null })
    expect(r.items.map((i: any) => i.subtotal)).toEqual([100000, 307500])
    // angka tidak cocok: ditandai perlu dicek
    expect((await post({ ...body, total_paid: 420000 })).check_passed).toBe(false)
    // nota tulisan tangan cukup pengecekan kedua
    expect((await post({ document_type: "nota", items: [{ name: "Box panel", unit: "pcs", qty: 1, unit_price: 85000 }], total_paid: 85000 }, PNG, "image/png")).check_passed).toBe(true)

    // Groq menolak, atau PDF lebih dari 3 halaman: draf tetap dibuat kosong dan penyebabnya dicatat di log server.
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const sent = fakeGroq(() => Response.json({ error: { message: "The model has been decommissioned" } }, { status: 400 }))
    expect(await post({})).toMatchObject({ status: "draf", items: [], extraction_raw: null })
    const d = await PDFDocument.create(); for (let i = 0; i < 4; i++) d.addPage([200, 200])
    expect(await post({}, Buffer.from(await d.save()))).toMatchObject({ items: [], extraction_raw: null })
    expect(sent).toHaveLength(1)
    expect(log.mock.calls.map(c => String(c[0]))).toEqual([expect.stringContaining("Groq 400: The model has been decommissioned"), expect.stringContaining("PDF 4 halaman")])

    // Kena batas per menit: tunggu sesuai header retry-after, lalu coba sekali lagi.
    let n = 0
    const limited = () => Response.json({ error: { message: "Rate limit reached" } }, { status: 429, headers: { "retry-after": "1" } })
    const sent2 = fakeGroq(() => n++ ? answer({ store_name: "Toko Surya", items: [{ name: "Fuse ANL 200A", qty: 1, unit_price: 55000 }],
      subtotal_products: 55000, total_paid: 55000 })() : limited())
    expect(await post({})).toMatchObject({ store_name: "Toko Surya", check_passed: true, total_paid: 55000 })
    expect(sent2).toHaveLength(2)
  })

  it("skenario 11: pembelian draf tidak terlihat client dan tidak masuk rekap", async () => {
    const { project, session } = await project23()
    const draft = await buy(project.id, 5000000, { confirm: false })
    const view = async () => (await call("GET", `/api/projects/${project.id}/purchases`, { as: session })).json
    expect((await view()).total).toBe(0)
    expect((await view()).recap.c_actual_spend).toBe(0)
    expect((await call("GET", `/api/files/${draft.file.id}`, { as: session })).status).toBe(404)
    await ok(call("POST", `/api/admin/purchases/${draft.id}/confirm`, { as: admin }))
    expect((await view()).total).toBe(5000000)
    expect((await view()).recap.c_actual_spend).toBe(5000000)
    expect((await call("GET", `/api/files/${draft.file.id}`, { as: session })).status).toBe(200)
  })

  it("skenario 12: tagihan tambahan tanpa bukti setuju client ditolak", async () => {
    const { project, session } = await project23()
    const x = await adjust(project.id, { amount: 500000, borne_by: "client" })
    const r = await call("POST", `/api/admin/projects/${project.id}/invoices/tambahan`, { as: admin, body: { cost_adjustment_ids: [x.id] } })
    expect(r.status).toBe(400)
    expect(r.json.code).toBe("NO_APPROVAL")
    // database juga menolak
    await expect(pool.query("update cost_adjustments set invoice_id = (select id from invoices limit 1) where id = $1", [x.id])).rejects.toThrow(/cost_adjustments_tagihan/)
    // tanggal setuju tanpa file bukti juga belum cukup
    await ok(call("PATCH", `/api/admin/cost-adjustments/${x.id}`, { as: admin, body: { client_approved_at: today() } }))
    expect((await call("POST", `/api/admin/projects/${project.id}/invoices/tambahan`, { as: admin, body: { cost_adjustment_ids: [x.id] } })).json.code).toBe("NO_APPROVAL")
    const proof = await f.upload(project.id, "bukti_setuju")
    await ok(call("PATCH", `/api/admin/cost-adjustments/${x.id}`, { as: admin, body: { proof_file_id: proof.id } }))
    const inv = await ok(call("POST", `/api/admin/projects/${project.id}/invoices/tambahan`, { as: admin, body: { cost_adjustment_ids: [x.id] } }))
    expect(inv.invoice).toMatchObject({ type: "tambahan", status: "terbit", amount_parts: 500000, total: 500000 })
    expect((await call("GET", `/api/projects/${project.id}/status`, { as: session })).json.invoices.map((i: any) => i.type)).toEqual(["awal", "tambahan"])
    // biaya yang ditanggung kami cukup dicatat tanpa tagihan
    const kami = await adjust(project.id, { amount: 300000, borne_by: "kami" })
    expect((await call("POST", `/api/admin/projects/${project.id}/invoices/tambahan`, { as: admin, body: { cost_adjustment_ids: [kami.id] } })).json.code).toBe("BORNE_BY_US")
  })

  it("skenario 13: proyek ditandai Selesai saat masih ada kekurangan, pengembalian belum dicatat, atau tagihan belum lunas ditolak dengan alasannya", async () => {
    // a. kekurangan yang belum diputuskan
    const a = await project23()
    await buy(a.project.id, 23800000)
    let r = await finish(a.project.id)
    expect(r.status).toBe(409)
    expect(r.json.error).toMatch(/kekurangan biaya part Rp800\.000/)
    await adjust(a.project.id, { amount: 800000, borne_by: "kami" })
    expect((await finish(a.project.id)).status).toBe(201)

    // b. pengembalian belum dicatat penuh
    const b = await project23()
    await buy(b.project.id, 22400000)
    r = await finish(b.project.id)
    expect(r.json.error).toMatch(/Pengembalian ke client belum dicatat penuh: harus Rp600\.000, tercatat Rp0/)
    await ok(call("POST", `/api/admin/projects/${b.project.id}/refunds`, { as: admin, body: { amount: 400000, refunded_at: today(), method: "Transfer" } }))
    expect((await finish(b.project.id)).json.error).toMatch(/tercatat Rp400\.000/)
    expect((await call("POST", `/api/admin/projects/${b.project.id}/refunds`, { as: admin, body: { amount: 300000, refunded_at: today(), method: "Transfer" } })).json.code).toBe("OVER_REFUND")
    await ok(call("POST", `/api/admin/projects/${b.project.id}/refunds`, { as: admin, body: { amount: 200000, refunded_at: today(), method: "Transfer" } }))
    expect((await finish(b.project.id)).status).toBe(201)

    // c. tagihan tambahan belum lunas
    const c = await project23()
    await buy(c.project.id, 23500000)
    const x = await adjust(c.project.id, { amount: 500000, borne_by: "client", client_approved_at: today(), proof_file_id: (await f.upload(c.project.id, "bukti_setuju")).id })
    const inv = (await ok(call("POST", `/api/admin/projects/${c.project.id}/invoices/tambahan`, { as: admin, body: { cost_adjustment_ids: [x.id] } }))).invoice
    r = await finish(c.project.id)
    expect(r.json.code).toBe("CANNOT_FINISH")
    expect(r.json.error).toContain(`Tagihan belum lunas: ${inv.number}`)
    await f.pay(inv.id, inv.total)
    const done = await finish(c.project.id)
    expect(done.status).toBe(201)
    const p = (await one(pool, "select finished_at, installed_kwp from projects where id = $1", [c.project.id]))!
    expect(p.finished_at).not.toBeNull()
    expect(p.installed_kwp).toBe(0.55) // 1 panel x 550 Wp dari Planning
  })
})

describe("B7 rekap dan pembelian", () => {
  it("aturan 18.8: rekap sesuai dua contoh di PRD 8.4", async () => {
    // belanja lebih kecil: A 23 jt, B 0, C 22,4 jt, D 0, dikembalikan 600 rb
    const kecil = await project23()
    await buy(kecil.project.id, 22400000)
    expect((await call("GET", `/api/projects/${kecil.project.id}/purchases`, { as: kecil.session })).json.recap).toEqual({
      a_billed_parts: 23000000, b_extra_parts_by_client: 0, c_actual_spend: 22400000, d_borne_by_us: 0, refund_due: 600000, refunded: 0, shortfall_undecided: 0 })
    // belanja lebih besar: A 23 jt, B 500 rb, C 23,8 jt, D 300 rb, dikembalikan 0
    const besar = await project23()
    await buy(besar.project.id, 23800000)
    await adjust(besar.project.id, { amount: 500000, borne_by: "client", client_approved_at: today(), proof_file_id: (await f.upload(besar.project.id, "bukti_setuju")).id })
    await adjust(besar.project.id, { amount: 300000, borne_by: "kami" })
    await adjust(besar.project.id, { amount: 999000, borne_by: "client", category: "jasa" }) // bukan part dan belum disetujui: tidak dihitung
    const v = (await call("GET", `/api/projects/${besar.project.id}/purchases`, { as: besar.session })).json
    expect(v.recap).toEqual({ a_billed_parts: 23000000, b_extra_parts_by_client: 500000, c_actual_spend: 23800000, d_borne_by_us: 300000,
      refund_due: 0, refunded: 0, shortfall_undecided: 0 })
    expect(v.part_adjustments.map((x: any) => [x.amount, x.borne_by])).toEqual([[500000, "client"], [300000, "kami"]])
  })

  it("tabel dikelompokkan Komponen Utama dan Aksesoris, PDF gabungan menyatukan semua file", async () => {
    const { project, session } = await project23()
    await buy(project.id, 15000000)
    await buy(project.id, 250000, { group: "aksesoris", file: PNG, type: "image/png" })
    const v = (await call("GET", `/api/projects/${project.id}/purchases`, { as: session })).json
    expect(v.groups.map((g: any) => [g.label, g.subtotal])).toEqual([["Komponen Utama", 15000000], ["Aksesoris", 250000]])
    expect(v.total).toBe(15250000)
    expect(v.groups[0].purchases[0]).toMatchObject({ store_name: "Toko Surya", note: "Invoice terlampir" })
    const merged = await call("GET", `/api/projects/${project.id}/purchases/gabungan.pdf`, { as: session })
    expect(merged.headers.get("content-type")).toBe("application/pdf")
    expect((await PDFDocument.load(merged.buf!)).getPageCount()).toBe(2)
    const other = await userSession(call, "client")
    expect((await call("GET", `/api/projects/${project.id}/purchases/gabungan.pdf`, { as: other })).status).toBe(404)
  })

  it("pembelian terkonfirmasi tidak bisa diubah, draf yang belum lengkap tidak bisa dikonfirmasi", async () => {
    const { project } = await project23()
    const done = await buy(project.id, 1000000)
    expect((await call("PATCH", `/api/admin/purchases/${done.id}`, { as: admin, body: { total_paid: 1 } })).json.code).toBe("CONFIRMED")
    await expect(pool.query("update purchases set total_paid = 1 where id = $1", [done.id])).rejects.toThrow(/tidak boleh diubah/)
    await expect(pool.query("delete from purchase_items where purchase_id = $1", [done.id])).rejects.toThrow(/tidak boleh diubah/)
    const x = (await ok(call("POST", `/api/admin/projects/${project.id}/purchases`, { as: admin, body: { document_type: "tanpa_nota", total_paid: 50000 } }))).purchase
    expect(x.check_passed).toBeNull()
    const r = await call("POST", `/api/admin/purchases/${x.id}/confirm`, { as: admin })
    expect(r.json.error).toMatch(/kelompok, toko, tanggal, barang/)
    await ok(call("PATCH", `/api/admin/purchases/${x.id}`, { as: admin, body: { item_group: "aksesoris", store_name: "Toko Bangunan", purchase_date: today(),
      items: [{ name: "Klem kabel", unit: "pcs", qty: 10, unit_price: 5000 }] } }))
    expect((await call("POST", `/api/admin/purchases/${x.id}/confirm`, { as: admin })).status).toBe(200)
  })

  it("belanja melebihi tagihan dan pengembalian yang tertunda muncul di Perlu Tindakan", async () => {
    const lebih = await project23()
    await buy(lebih.project.id, 20000000)
    const r = await call("POST", `/api/admin/purchases/${(await buy(lebih.project.id, 4000000, { confirm: false })).id}/confirm`, { as: admin })
    expect(r.json.warning).toMatch(/melewati tagihan part Rp1\.000\.000/)
    const kurang = await project23()
    await buy(kurang.project.id, 20000000)
    await pool.query("alter table purchases disable trigger purchases_tetap")
    await pool.query("update purchases set created_at = now() - interval '8 days', confirmed_at = now() - interval '8 days' where project_id = $1", [kurang.project.id])
    await pool.query("alter table purchases enable trigger purchases_tetap")
    const items = (await call("GET", "/api/admin/home/perlu-tindakan?all=true", { as: admin })).json.items
    expect(items.some((i: any) => i.reason === "belanja_melebihi_tagihan" && i.project_id === lebih.project.id)).toBe(true)
    expect(items.some((i: any) => i.reason === "pengembalian_belum_dicatat" && i.project_id === kurang.project.id && i.detail === "Sisa Rp3.000.000")).toBe(true)
  })
})
