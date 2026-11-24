import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { all, one, pool } from "../../core/db.js"
import { flow } from "../../test/flow.js"
import { seedTestData, type PartKey } from "../../test/test-data.js"
import { client, freshTestDb, pdfText, startApp, userSession, type Session } from "../../test/test-db.js"

let app: Awaited<ReturnType<typeof startApp>>, call: ReturnType<typeof client>, admin: Session, ids: Record<PartKey, string>, f: ReturnType<typeof flow>
beforeAll(async () => {
  await freshTestDb(); ids = await seedTestData()
  app = await startApp(); call = client(app.base); admin = await userSession(call, "admin"); f = flow(call, admin, ids)
})
afterAll(async () => { await app.close(); await pool.end() })

const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const plusDays = (n: number) => new Date(Date.now() + 7 * 3600e3 + n * 86400e3).toISOString().slice(0, 10)

describe("B6 skenario uji", () => {
  it("skenario 9: tagihan awal diterbitkan lalu dicatat lunas, status pindah ke Menunggu Pembayaran lalu On Progress", async () => {
    const { project, session } = await f.accepted()
    expect(await f.statusKey(project.id)).toBe("planning")
    const pl = await f.finalPlanning(project.id)
    const invoice = await f.issue(project.id)
    expect(invoice).toMatchObject({ type: "awal", status: "terbit", total: pl.grand_total, amount_parts: pl.total_parts, price_valid_until: pl.price_valid_until })
    expect(invoice.number).toMatch(/^INV-\d{4}-\d{3}$/)
    expect(await f.statusKey(project.id)).toBe("menunggu_pembayaran")
    // dibayar dua kali: baru pindah setelah lunas
    await f.pay(invoice.id, 1000000)
    expect(await f.statusKey(project.id)).toBe("menunggu_pembayaran")
    const last = await f.pay(invoice.id, invoice.total - 1000000)
    expect(last.invoice.status).toBe("lunas")
    expect(await f.statusKey(project.id)).toBe("on_progress")
    const st = (await call("GET", `/api/projects/${project.id}/status`, { as: session })).json
    expect(st.project.sub_status_name).toBe("Pembelian Part")
    expect(st.history.map((h: any) => h.status_name).slice(0, 3)).toEqual(["On Progress", "Menunggu Pembayaran", "Planning"])
    // client bisa mengunduh PDF tagihan dari halaman Status Pengerjaan
    expect(st.invoices[0].number).toBe(invoice.number)
    const pdf = await call("GET", `/api/files/${st.invoices[0].pdf_file_id}`, { as: session })
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get("content-type")).toBe("application/pdf")
    expect(pdf.buf!.subarray(0, 5).toString()).toBe("%PDF-")
  })

  it("PDF tagihan untuk client: part rinci, SDM, Jasa, dan Akomodasi jadi satu baris Biaya Jasa; pratinjau sama tapi tidak menyimpan apa pun", async () => {
    const { project, session } = await f.accepted()
    const preview = () => call("GET", `/api/admin/projects/${project.id}/invoices/preview`, { as: admin })
    expect((await preview()).json.code).toBe("PLANNING_DRAFT")
    const pl = await f.finalPlanning(project.id)
    const count = async () => (await one(pool, "select count(*)::int n from invoices where project_id = $1", [project.id])).n
    const r = await preview()
    expect(r.status).toBe(200)
    expect(r.headers.get("content-type")).toMatch(/application\/pdf/)
    const text = await pdfText(r.buf!)
    const rp = (n: number) => "Rp" + n.toLocaleString("id-ID")
    const jasa = pl.total_labor + pl.total_services + pl.total_accommodation
    expect(text).toContain("PRATINJAU")
    expect(text).toContain(`Total Part ${rp(pl.total_parts)}`)
    expect(text).toContain(`Biaya Jasa ${rp(jasa)}`)
    expect(text).toContain(`TOTAL TAGIHAN ${rp(pl.grand_total)}`)
    for (const hidden of ["SDM", "Akomodasi", "Transport tim", "Instalasi dan setting inverter", "orang"]) expect(text, hidden).not.toContain(hidden)
    // pratinjau tidak menyimpan tagihan dan tidak mengubah status proyek
    expect(await count()).toBe(0)
    expect(await f.statusKey(project.id)).toBe("planning")
    expect((await call("GET", `/api/admin/projects/${project.id}/invoices/preview`, { as: session })).status).toBe(403)

    const invoice = await f.issue(project.id)
    const issued = await pdfText((await call("GET", `/api/files/${invoice.pdf_file_id}`, { as: session })).buf!)
    expect(issued).toContain(`No: ${invoice.number}`)
    expect(issued).not.toContain("PRATINJAU")
    // isi tagihan yang terbit sama dengan pratinjaunya, kecuali nomor
    const body = (t: string) => t.slice(t.indexOf("Ditagihkan kepada"))
    expect(body(issued)).toBe(body(text))
    // di database rincian tetap tersimpan per kelompok untuk admin
    expect(invoice).toMatchObject({ amount_labor: pl.total_labor, amount_services: pl.total_services, amount_accommodation: pl.total_accommodation })
    expect((await preview()).json.code).toBe("INVALID_STATUS")
  })

  it("skenario 20: tagihan awal yang belum dibayar dibatalkan, proyek kembali ke Planning dan Planning bisa diubah lagi", async () => {
    const { project } = await f.accepted()
    await f.finalPlanning(project.id)
    const invoice = await f.issue(project.id)
    expect((await call("PUT", `/api/admin/projects/${project.id}/planning`, { as: admin, body: { items: [] } })).status).toBe(409)
    const r = await call("POST", `/api/admin/invoices/${invoice.id}/cancel`, { as: admin, body: { note: "Harga sudah tidak berlaku" } })
    expect(r.status).toBe(200)
    expect(r.json.invoice.status).toBe("batal")
    expect(await f.statusKey(project.id)).toBe("planning")
    const put = await call("PUT", `/api/admin/projects/${project.id}/planning`, { as: admin,
      body: { items: [{ type: "part", part_id: ids.panel550, qty: 4 }, { type: "jasa", description: "Instalasi", unit_price: 3000000 }] } })
    expect(put.status).toBe(200)
    expect(put.json.planning.grand_total).toBe(4 * 1700000 + 3000000)
    // tagihan baru bisa diterbitkan lagi
    await call("POST", `/api/admin/projects/${project.id}/planning/finalize`, { as: admin, body: {} })
    expect((await f.issue(project.id)).status).toBe("terbit")
  })

})

describe("B6 tagihan dan pembayaran", () => {
  it("aturan 18.6: satu planning dan satu tagihan awal yang tidak batal per proyek", async () => {
    const { project } = await f.accepted()
    await f.finalPlanning(project.id)
    await f.issue(project.id)
    // status proyek sudah Menunggu Pembayaran, dan tagihan awal kedua ditolak juga oleh database
    expect((await call("POST", `/api/admin/projects/${project.id}/invoices`, { as: admin, body: {} })).status).toBe(409)
    const pl = (await one(pool, "select id from plannings where project_id = $1", [project.id]))!
    await expect(pool.query(`insert into invoices (project_id, planning_id, type, number, status, issued_at, due_date, amount_parts, amount_labor, amount_services,
      amount_accommodation, total, created_by) values ($1, $2, 'awal', 'INV-TES-1', 'terbit', now(), current_date, 1, 0, 0, 0, 1, (select id from users limit 1))`,
      [project.id, pl.id])).rejects.toThrow(/invoices_satu_tagihan_awal/)
    await expect(pool.query("insert into plannings (project_id, created_by) values ($1, (select id from users limit 1))", [project.id])).rejects.toThrow(/plannings_project_id_key/)
  })

  it("aturan 18.4: perubahan harga part tidak mengubah planning dan tagihan yang sudah dibuat", async () => {
    const { project } = await f.accepted()
    await f.finalPlanning(project.id)
    const invoice = await f.issue(project.id)
    const snap = async () => ({
      planning: await all(pool, "select i.unit_price, i.subtotal from planning_items i join plannings p on p.id = i.planning_id where p.project_id = $1 order by i.sort_order", [project.id]),
      invoice: await all(pool, "select unit_price, subtotal from invoice_items where invoice_id = $1 order by sort_order", [invoice.id]),
    })
    const before = await snap()
    await call("PATCH", `/api/admin/parts/${ids.inv3000}`, { as: admin, body: { unit_price: 7500000 } })
    expect(await snap()).toEqual(before)
    await call("PATCH", `/api/admin/parts/${ids.inv3000}`, { as: admin, body: { unit_price: 6080000 } })
  })

  it("pembayaran tidak boleh melebihi sisa tagihan, dan tagihan yang sudah dibayar tidak bisa dibatalkan", async () => {
    const { project } = await f.accepted()
    await f.finalPlanning(project.id)
    const invoice = await f.issue(project.id)
    expect((await call("POST", `/api/admin/invoices/${invoice.id}/payments`, { as: admin, body: { amount: invoice.total + 1, paid_at: todayWib(), method: "Transfer" } })).json.code).toBe("OVERPAID")
    const proof = await f.upload(project.id, "bukti_bayar")
    const r = await call("POST", `/api/admin/invoices/${invoice.id}/payments`, { as: admin, body: { amount: 500000, paid_at: todayWib(), method: "QRIS", proof_file_id: proof.id } })
    expect(r.json.payment).toMatchObject({ amount: 500000, method: "QRIS", proof_file_id: proof.id })
    expect((await call("POST", `/api/admin/invoices/${invoice.id}/cancel`, { as: admin })).json.code).toBe("HAS_PAYMENT")
  })

  it("pembayaran setelah masa berlaku harga lewat memunculkan peringatan tanpa mengunci proyek", async () => {
    const { project } = await f.accepted()
    await f.finalPlanning(project.id)
    const invoice = await f.issue(project.id)
    await f.pay(invoice.id, invoice.total, plusDays(10))
    expect(await f.statusKey(project.id)).toBe("on_progress")
    const detail = (await call("GET", `/api/admin/projects/${project.id}`, { as: admin })).json
    expect(detail.warnings[0]).toMatch(/Cek ulang harga part/)
    const todo = (await call("GET", "/api/admin/home/perlu-tindakan?all=true", { as: admin })).json.items
    expect(todo.some((i: any) => i.reason === "pembayaran_setelah_harga_berlaku" && i.project_id === project.id)).toBe(true)
  })

  it("tagihan lewat jatuh tempo muncul di Perlu Tindakan dan ringkasan Tagihan", async () => {
    const { project } = await f.accepted()
    await f.finalPlanning(project.id)
    const invoice = await f.issue(project.id)
    await pool.query("update invoices set due_date = current_date - 3 where id = $1", [invoice.id])
    const todo = (await call("GET", "/api/admin/home/perlu-tindakan?all=true", { as: admin })).json.items
    expect(todo.some((i: any) => i.reason === "tagihan_belum_dibayar" && i.detail === invoice.number)).toBe(true)
    const t = (await call("GET", `/api/admin/home/tagihan?month=${todayWib().slice(0, 7)}`, { as: admin })).json
    expect(t.billed).toBeGreaterThan(0)
    expect(t.billed - t.paid).toBe(t.unpaid)
    expect(t.overdue.count).toBeGreaterThanOrEqual(1)
  })

  it("cara pembayaran yang belum diisi tim membuat tagihan belum bisa terbit, nama usaha boleh kosong", async () => {
    const { project } = await f.accepted()
    await f.finalPlanning(project.id)
    await pool.query("update settings set value = 'null' where key = 'payment_instructions'")
    const r = await call("POST", `/api/admin/projects/${project.id}/invoices`, { as: admin, body: {} })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe("SETTING_NOT_FILLED")
    expect(await f.statusKey(project.id)).toBe("planning")
    await pool.query(`update settings set value = '"Transfer ke rekening tes"' where key = 'payment_instructions'`)
    // tanpa nama usaha: tagihan tetap terbit, PDF tanpa baris nama usaha
    await pool.query("update settings set value = 'null' where key = 'business_name'")
    const invoice = await f.issue(project.id)
    expect(invoice.status).toBe("terbit")
    expect((await call("GET", `/api/files/${invoice.pdf_file_id}`, { as: admin })).buf!.subarray(0, 5).toString()).toBe("%PDF-")
    await pool.query(`update settings set value = '"Usaha PLTS Tes"' where key = 'business_name'`)
  })
})
