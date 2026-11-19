import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { all, one, pool } from "../core/db.js"
import { flow } from "./flow.js"
import { seedTestData, type PartKey } from "./test-data.js"
import { client, freshTestDb, startApp, userSession, type Session } from "./test-db.js"

// Sepuluh aturan data di PRD bagian 18, satu tes per aturan.
let app: Awaited<ReturnType<typeof startApp>>, call: ReturnType<typeof client>, admin: Session, ids: Record<PartKey, string>, f: ReturnType<typeof flow>
beforeAll(async () => {
  await freshTestDb(); ids = await seedTestData()
  app = await startApp(); call = client(app.base); admin = await userSession(call, "admin"); f = flow(call, admin, ids)
})
afterAll(async () => { await app.close(); await pool.end() })

const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const ok = async (r: Promise<{ status: number; json: any }>) => { const x = await r; if (x.status >= 300) throw new Error(`${x.status} ${JSON.stringify(x.json)}`); return x.json }

describe("PRD bagian 18: aturan data", () => {
  it("1. Kepemilikan: data turunan proyek dan file hanya untuk pemilik proyek", async () => {
    const a = await f.onProgress(), b = await f.onProgress()
    const photo = await f.upload(b.project.id, "foto_status")
    const paths = [`/api/projects/${b.project.id}/status`, `/api/projects/${b.project.id}/purchases`, `/api/projects/${b.project.id}/purchases/gabungan.pdf`,
      `/api/files/${photo.id}`, `/api/files/${b.invoice.pdf_file_id}`]
    for (const p of paths) {
      expect((await call("GET", p, { as: a.session })).status, p).toBe(404)
      expect((await call("GET", p, { as: b.session })).status, p).toBe(200)
    }
    // file dicek lewat kolom project_id di tabel files
    expect((await one(pool, "select project_id from files where id = $1", [photo.id]))!.project_id).toBe(b.project.id)
  })

  it("2. Uang: nominal selalu angka bulat rupiah, qty boleh desimal", async () => {
    const types = await all(pool, `select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'
      and column_name in ('unit_price', 'subtotal', 'amount', 'total', 'total_paid', 'monthly_bill', 'est_investment', 'grand_total', 'qty')`)
    for (const t of types) expect(t.data_type, `${t.table_name}.${t.column_name}`).toBe(t.column_name === "qty" ? "numeric" : "bigint")
    expect((await call("POST", "/api/admin/parts", { as: admin, body: { category: "aksesoris", name: "X", unit: "pcs", unit_price: 10.5 } })).status).toBe(400)
    const { project } = await f.accepted()
    const r = await ok(call("PUT", `/api/admin/projects/${project.id}/planning`, { as: admin, body: { items: [{ type: "part", part_id: ids.kabel, qty: 3.3333 }] } }))
    expect(r.items[0].subtotal).toBe(50000) // 3,3333 x 15.000 = 49.999,5 dibulatkan ke atas
  })

  it("3. Tidak ada hapus permanen untuk users, parts, project_statuses, dan project_sub_statuses", async () => {
    for (const t of ["users", "parts", "project_statuses", "project_sub_statuses"])
      await expect(pool.query(`delete from ${t} where id = (select id from ${t} limit 1)`), t).rejects.toThrow(/tidak boleh dihapus/)
    expect((await call("DELETE", `/api/admin/parts/${ids.kabel}`, { as: admin })).status).toBe(404)
    expect((await call("PATCH", `/api/admin/parts/${ids.kabel}`, { as: admin, body: { is_active: false } })).json.part.is_active).toBe(false)
    await call("PATCH", `/api/admin/parts/${ids.kabel}`, { as: admin, body: { is_active: true } })
  })

  it("4. Salinan harga: simulasi, planning, dan tagihan tidak ikut berubah saat harga part diubah", async () => {
    const { project, sim } = await f.accepted()
    await f.finalPlanning(project.id)
    const invoice = await f.issue(project.id)
    const before = {
      sim: await one(pool, "select snapshot, est_investment from simulations where id = $1", [sim.id]),
      planning: await all(pool, "select unit_price, subtotal from planning_items i join plannings p on p.id = i.planning_id where p.project_id = $1 order by sort_order", [project.id]),
      invoice: await all(pool, "select unit_price, subtotal from invoice_items where invoice_id = $1 order by sort_order", [invoice.id]),
    }
    for (const k of ["panel550", "inv3000", "bat24"] as const) await ok(call("PATCH", `/api/admin/parts/${ids[k]}`, { as: admin, body: { unit_price: 1 } }))
    expect({
      sim: await one(pool, "select snapshot, est_investment from simulations where id = $1", [sim.id]),
      planning: await all(pool, "select unit_price, subtotal from planning_items i join plannings p on p.id = i.planning_id where p.project_id = $1 order by sort_order", [project.id]),
      invoice: await all(pool, "select unit_price, subtotal from invoice_items where invoice_id = $1 order by sort_order", [invoice.id]),
    }).toEqual(before)
    await ok(call("PATCH", `/api/admin/parts/${ids.panel550}`, { as: admin, body: { unit_price: 1700000 } }))
    await ok(call("PATCH", `/api/admin/parts/${ids.inv3000}`, { as: admin, body: { unit_price: 6080000 } }))
    await ok(call("PATCH", `/api/admin/parts/${ids.bat24}`, { as: admin, body: { unit_price: 12000000 } }))
  })

  it("5. Status: status_updates adalah riwayat, projects.status_id selalu sama dengan riwayat terakhir", async () => {
    const { project } = await f.onProgress()
    const last = await one(pool, "select status_id, sub_status_id from status_updates where project_id = $1 order by created_at desc, id desc limit 1", [project.id])
    expect(await one(pool, "select status_id, sub_status_id from projects where id = $1", [project.id])).toEqual(last)
    const keys = (await all(pool, `select s.system_key from status_updates u join project_statuses s on s.id = u.status_id where u.project_id = $1 order by u.created_at`, [project.id])).map(r => r.system_key)
    expect(keys).toEqual(["pengajuan", "planning", "menunggu_pembayaran", "on_progress"])
    await expect(pool.query("delete from status_updates where project_id = $1", [project.id])).rejects.toThrow(/tidak boleh diubah/)
    // status akhir bulan diambil dari riwayat
    const rows = (await call("GET", `/api/admin/home/status-bulanan?month=${today().slice(0, 7)}`, { as: admin })).json.rows
    expect(rows.find((r: any) => r.id === project.id).status_key).toBe("on_progress")
  })

  it("6. Satu planning dan satu tagihan awal yang tidak batal per proyek; tagihan tambahan boleh lebih dari satu", async () => {
    const { project } = await f.onProgress()
    expect((await call("POST", `/api/admin/projects/${project.id}/invoices`, { as: admin, body: {} })).status).toBe(409)
    await expect(pool.query("insert into plannings (project_id, created_by) values ($1, (select id from users limit 1))", [project.id])).rejects.toThrow(/unique/)
    for (const amount of [100000, 200000]) {
      const x = await ok(call("POST", `/api/admin/projects/${project.id}/cost-adjustments`, { as: admin, body: { category: "jasa", amount, reason: "kondisi_lokasi",
        explanation: "Tambahan kabel duct", borne_by: "client", client_approved_at: today(), proof_file_id: (await f.upload(project.id, "bukti_setuju")).id } }))
      await ok(call("POST", `/api/admin/projects/${project.id}/invoices/tambahan`, { as: admin, body: { cost_adjustment_ids: [x.cost_adjustment.id] } }))
    }
    expect((await one(pool, "select count(*)::int n from invoices where project_id = $1 and type = 'tambahan'", [project.id]))!.n).toBe(2)
  })

  it("7. Pembelian: hanya yang terkonfirmasi terlihat client dan masuk rekap", async () => {
    const { project, session } = await f.onProgress()
    const file = await f.upload(project.id, "invoice_pembelian")
    const x = (await ok(call("POST", `/api/admin/projects/${project.id}/purchases`, { as: admin, body: { document_type: "invoice", file_id: file.id, item_group: "aksesoris",
      store_name: "Toko", purchase_date: today(), subtotal_products: 70000, total_paid: 70000, items: [{ name: "MCB", unit: "pcs", qty: 1, unit_price: 70000 }] } }))).purchase
    const view = async () => (await call("GET", `/api/projects/${project.id}/purchases`, { as: session })).json
    expect([(await view()).total, (await view()).recap.c_actual_spend]).toEqual([0, 0])
    await ok(call("POST", `/api/admin/purchases/${x.id}/confirm`, { as: admin }))
    expect([(await view()).total, (await view()).recap.c_actual_spend]).toEqual([70000, 70000])
  })

  it("8. Rekap: A, B, C, D dan pengembalian = A + B - C kalau positif", async () => {
    const { project, session, invoice } = await f.onProgress()
    const A = invoice.amount_parts
    const file = await f.upload(project.id, "invoice_pembelian")
    const x = (await ok(call("POST", `/api/admin/projects/${project.id}/purchases`, { as: admin, body: { document_type: "invoice", file_id: file.id, item_group: "komponen_utama",
      store_name: "Toko", purchase_date: today(), subtotal_products: A - 250000, total_paid: A - 250000, items: [{ name: "Paket", unit: "unit", qty: 1, unit_price: A - 250000 }] } }))).purchase
    await ok(call("POST", `/api/admin/purchases/${x.id}/confirm`, { as: admin }))
    await ok(call("POST", `/api/admin/projects/${project.id}/cost-adjustments`, { as: admin, body: { category: "part", amount: 100000, reason: "lainnya",
      explanation: "Klem tambahan", borne_by: "client", client_approved_at: today(), proof_file_id: (await f.upload(project.id, "bukti_setuju")).id } }))
    await ok(call("POST", `/api/admin/projects/${project.id}/cost-adjustments`, { as: admin, body: { category: "part", amount: 50000, reason: "kesalahan_kami",
      explanation: "Salah beli konektor", borne_by: "kami" } }))
    const r = (await call("GET", `/api/projects/${project.id}/purchases`, { as: session })).json.recap
    expect(r).toMatchObject({ a_billed_parts: A, b_extra_parts_by_client: 100000, c_actual_spend: A - 250000, d_borne_by_us: 50000, refund_due: 350000, shortfall_undecided: 0 })
  })

  it("9. Biaya Tambahan tanggungan client tidak boleh punya tagihan sebelum tanggal setuju dan bukti terisi", async () => {
    const { project } = await f.onProgress()
    const x = (await ok(call("POST", `/api/admin/projects/${project.id}/cost-adjustments`, { as: admin, body: { category: "part", amount: 100000,
      reason: "kenaikan_harga", explanation: "Harga naik", borne_by: "client" } }))).cost_adjustment
    expect((await call("POST", `/api/admin/projects/${project.id}/invoices/tambahan`, { as: admin, body: { cost_adjustment_ids: [x.id] } })).json.code).toBe("NO_APPROVAL")
    await expect(pool.query("update cost_adjustments set invoice_id = (select id from invoices where project_id = $2 limit 1) where id = $1", [x.id, project.id]))
      .rejects.toThrow(/cost_adjustments_tagihan/)
  })

  it("10. Selesai: hanya kalau tidak ada kekurangan, pengembalian sudah penuh, dan semua tagihan lunas", async () => {
    const { project, invoice } = await f.onProgress()
    const selesai = (await one(pool, "select id from project_statuses where system_key = 'selesai'"))!.id
    const done = () => call("POST", `/api/admin/projects/${project.id}/status-updates`, { as: admin, body: { status_id: selesai, note: "Selesai" } })
    // belum ada pembelian: seluruh tagihan part harus dikembalikan dulu
    const r = await done()
    expect(r.json.code).toBe("CANNOT_FINISH")
    expect(r.json.error).toContain(`harus Rp${invoice.amount_parts.toLocaleString("id-ID")}`)
    const file = await f.upload(project.id, "invoice_pembelian")
    const x = (await ok(call("POST", `/api/admin/projects/${project.id}/purchases`, { as: admin, body: { document_type: "invoice", file_id: file.id, item_group: "komponen_utama",
      store_name: "Toko", purchase_date: today(), subtotal_products: invoice.amount_parts, total_paid: invoice.amount_parts,
      items: [{ name: "Paket", unit: "unit", qty: 1, unit_price: invoice.amount_parts }] } }))).purchase
    await ok(call("POST", `/api/admin/purchases/${x.id}/confirm`, { as: admin }))
    expect((await done()).status).toBe(201)
  })
})
