import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { one, pool } from "../../core/db.js"
import { seedTestData, type PartKey } from "../../test/test-data.js"
import { client, freshTestDb, startApp, userSession, type Session } from "../../test/test-db.js"
import { verifyToken } from "../../core/tokens.js"

let app: Awaited<ReturnType<typeof startApp>>, call: ReturnType<typeof client>, admin: Session, ids: Record<PartKey, string>
beforeAll(async () => {
  await freshTestDb(); ids = await seedTestData()
  app = await startApp(); call = client(app.base); admin = await userSession(call, "admin")
})
afterAll(async () => { await app.close(); await pool.end() })

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex")
const simple = (o: Record<string, unknown> = {}) => ({ system_type: "hybrid_offgrid", pln_power_va: 2200, monthly_bill: 1000000, usage_pattern: "seimbang",
  panel_part_id: ids.panel550, panel_qty: 4, inverter_part_id: ids.inv3000, battery_part_id: ids.bat24, battery_qty: 1, ...o })
const saveSim = async (as: Session, o: Record<string, unknown> = {}) => {
  const r = await call("POST", "/api/simulations", { as, body: simple(o) })
  if (r.status !== 201) throw new Error(JSON.stringify(r.json))
  return r.json.simulation
}
const submit = (as: Session, simId: string) => call("POST", `/api/simulations/${simId}/submit`, { as, body: { address: "Jl. Mawar 1", city: "Bandung", request_note: "Atap genteng" } })
const statusId = async (key: string) => (await one(pool, "select id from project_statuses where system_key = $1", [key]))!.id
// Guest mengajukan, admin menerima: hasilnya client dengan proyek di Planning.
async function acceptedClient() {
  const g = await userSession(call, "guest")
  const sim = await saveSim(g)
  const p = (await submit(g, sim.id)).json.project
  await call("POST", `/api/admin/projects/${p.id}/accept`, { as: admin })
  await call("POST", "/api/auth/refresh", { as: g })
  return { session: g, project: p, sim }
}
const upload = (projectId: string, purpose: string, buf = PNG, type = "image/png") =>
  call("POST", `/api/admin/projects/${projectId}/files?purpose=${purpose}`, { as: admin, raw: buf, headers: { "content-type": type, "x-filename": "foto%20atap.png" } })

describe("B5 skenario uji", () => {
  it("skenario 1: client A ditolak saat meminta data, tagihan, atau file proyek client B", async () => {
    const a = await acceptedClient(), b = await acceptedClient()
    const file = (await upload(b.project.id, "foto_status")).json.file
    await call("POST", `/api/admin/projects/${b.project.id}/status-updates`, { as: admin, body: { note: "Survey lokasi", photo_file_ids: [file.id] } })
    const pdf = (await upload(b.project.id, "bukti_bayar", Buffer.from("%PDF-1.4 tes"), "application/pdf")).json.file
    await pool.query(`insert into invoices (project_id, type, number, status, issued_at, due_date, amount_parts, amount_labor, amount_services, amount_accommodation, total, pdf_file_id, created_by)
      values ($1, 'tambahan', 'INV-2026-901', 'terbit', now(), current_date, 100, 0, 0, 0, 100, $2, (select id from users where role = 'admin' limit 1))`, [b.project.id, pdf.id])

    // B sendiri bisa membuka
    expect((await call("GET", `/api/projects/${b.project.id}/status`, { as: b.session })).status).toBe(200)
    expect((await call("GET", `/api/files/${file.id}`, { as: b.session })).status).toBe(200)
    // A ditolak untuk semua jalur dengan id milik B
    for (const path of [`/api/projects/${b.project.id}/status`, `/api/files/${file.id}`, `/api/files/${pdf.id}`, `/api/simulations/${b.sim.id}`]) {
      const r = await call("GET", path, { as: a.session })
      expect(r.status, path).toBe(404)
      expect(JSON.stringify(r.json)).not.toContain("INV-2026-901")
    }
    expect((await call("GET", `/api/admin/projects/${b.project.id}`, { as: a.session })).status).toBe(403)
    const list = await call("GET", "/api/projects", { as: a.session })
    expect(list.json.projects.map((p: any) => p.id)).toEqual([a.project.id])
  })

  it("skenario 4: admin menerima pengajuan saat guest masih login, guest melihat tampilan client tanpa login ulang", async () => {
    const g = await userSession(call, "guest")
    const p = (await submit(g, (await saveSim(g)).id)).json.project
    expect((await call("GET", "/api/projects", { as: g })).status).toBe(403)
    expect((await call("POST", `/api/admin/projects/${p.id}/accept`, { as: admin })).status).toBe(200)
    // frontend memanggil /me saat Home dibuka; role di database sudah client
    const me = await call("GET", "/api/me", { as: g })
    expect(me.json.user.role).toBe("client")
    expect(verifyToken(g.token!)!.role).toBe("guest")
    // role berbeda dari token: frontend meminta token baru lewat cookie, tanpa login ulang
    const r = await call("POST", "/api/auth/refresh", { as: g })
    expect(r.status).toBe(200)
    expect(verifyToken(g.token!)!.role).toBe("client")
    expect((await call("GET", "/api/projects", { as: g })).json.projects[0].status_key).toBe("planning")
  })

  it("skenario 5: harga part diubah setelah simulasi diajukan, angka di simulasi yang diajukan tidak berubah", async () => {
    const g = await userSession(call, "guest")
    const sim = await saveSim(g)
    await submit(g, sim.id)
    await call("PATCH", `/api/admin/parts/${ids.panel550}`, { as: admin, body: { unit_price: 2500000 } })
    await call("PATCH", `/api/admin/parts/${ids.bat24}`, { as: admin, body: { unit_price: 9000000 } })
    const after = (await call("GET", `/api/simulations/${sim.id}`, { as: g })).json.simulation
    for (const k of ["est_investment", "monthly_saving", "net_profit", "bep_years", "snapshot", "params"]) expect(after[k], k).toEqual(sim[k])
    expect(after.snapshot.panel.unit_price).toBe(1700000)
    expect(after.is_locked).toBe(true)
    await call("PATCH", `/api/admin/parts/${ids.panel550}`, { as: admin, body: { unit_price: 1700000 } })
    await call("PATCH", `/api/admin/parts/${ids.bat24}`, { as: admin, body: { unit_price: 12000000 } })
  })

  it("skenario 7: simulasi dengan tegangan panel melebihi batas inverter tidak bisa diajukan", async () => {
    // Admin menyusun 5 panel seri (Voc dingin 263 V, batas inverter 245 V), lalu simulasinya dipakai guest.
    const g = await userSession(call, "guest")
    const sim = (await call("POST", "/api/simulations", { as: admin, body: simple({ panel_qty: 5, panel_series: 5, panel_parallel: 1 }) })).json.simulation
    expect(sim.danger).toBe(true)
    expect(sim.tips.find((t: any) => t.kind === "bad").text).toMatch(/Voc/)
    await pool.query("update simulations set user_id = $1 where id = $2", [g.id, sim.id])
    const r = await submit(g, sim.id)
    expect(r.status).toBe(400)
    expect(r.json.code).toBe("DANGER")
    // konfigurasi yang tidak pernah balik modal juga berlabel Bahaya
    const kecil = await saveSim(g, { monthly_bill: 60000, battery_qty: 2 })
    expect(kecil.bep_years).toBeNull()
    expect((await submit(g, kecil.id)).json.code).toBe("DANGER")
  })
})

describe("B5 pengajuan dan proyek", () => {
  it("satu pengajuan menunggu per akun, ditolak dengan alasan, lalu boleh mengajukan lagi", async () => {
    const g = await userSession(call, "guest")
    const s1 = await saveSim(g), s2 = await saveSim(g)
    const p = (await submit(g, s1.id)).json.project
    expect(p.code).toMatch(/^PLTS-\d{4}-\d{3}$/)
    expect(p.name).toBe("PLTS 2,2 kWp")
    expect((await submit(g, s2.id)).json.code).toBe("PENDING_SUBMISSION")
    expect((await submit(g, s1.id)).json.code).toBe("ALREADY_SUBMITTED")
    expect((await call("POST", `/api/admin/projects/${p.id}/reject`, { as: admin, body: {} })).status).toBe(400)
    expect((await call("POST", `/api/admin/projects/${p.id}/reject`, { as: admin, body: { reason: "Di luar area layanan" } })).status).toBe(200)
    const home = (await call("GET", "/api/home", { as: g })).json
    expect(home.projects[0]).toMatchObject({ status_key: "ditolak", rejected_reason: "Di luar area layanan" })
    expect(home.projects[0].address).toBeUndefined() // guest hanya melihat status dan alasan
    expect((await call("GET", "/api/me", { as: g })).json.user.role).toBe("guest")
    expect((await submit(g, s2.id)).status).toBe(201)
    expect((await call("POST", `/api/admin/projects/${p.id}/accept`, { as: admin })).status).toBe(409)
  })

  it("menerima pengajuan mengisi Planning dari simulasi dengan harga List Part saat ini, termasuk aksesoris dan baris jasa", async () => {
    await pool.query("update parts set unit_price = 28000 where id = $1", [ids.kabelPv]) // harga List Part saat Planning dibuat yang dipakai
    const { project, sim } = await acceptedClient()
    await pool.query("update parts set unit_price = 27000 where id = $1", [ids.kabelPv])
    const items = (await pool.query("select i.* from planning_items i join plannings p on p.id = i.planning_id where p.project_id = $1 order by sort_order", [project.id])).rows
    expect(items.map(i => [i.type, i.description, i.qty, i.unit_price])).toEqual([["part", "Panel 550 Wp", 4, 1700000], ["part", "Inverter 3000 W 24 V", 1, 6080000],
      ["part", "LiFePO4 24 V 100 Ah", 1, 12000000], ["part", "Kabel PV 4 mm", 30, 28000], ["part", "Rail aluminium", 6, 60000],
      ["jasa", "Jasa (estimasi dari simulasi)", 1, 5400000]])
    const parts = 4 * 1700000 + 6080000 + 12000000 + 30 * 28000 + 6 * 60000
    const pl = (await one(pool, "select * from plannings where project_id = $1", [project.id]))!
    expect(pl).toMatchObject({ status: "draf", total_parts: parts, total_services: 5400000, grand_total: parts + 5400000 })
    const detail = (await call("GET", `/api/admin/projects/${project.id}`, { as: admin })).json
    expect(detail.simulation.id).toBe(sim.id)
    expect(detail.project.pic.name).toMatch(/admin/)
  })

  it("skenario 26: pengajuan on-grid 4 panel 550 Wp diterima, Planning terisi part, aksesoris, dan satu baris jasa Rp5.400.000", async () => {
    const g = await userSession(call, "guest")
    const sim = await saveSim(g, { system_type: "on_grid", inverter_part_id: ids.invOnGrid2000, battery_part_id: null, battery_qty: 0 })
    expect(sim.snapshot.service_estimate).toBe(5400000) // Rp1.000.000 + Rp2.000.000 x 2,2 kWp
    const p = (await submit(g, sim.id)).json.project
    expect((await call("POST", `/api/admin/projects/${p.id}/accept`, { as: admin })).status).toBe(200)
    const items = (await pool.query("select i.* from planning_items i join plannings p on p.id = i.planning_id where p.project_id = $1 order by sort_order", [p.id])).rows
    expect(items.map(i => [i.type, i.description, i.qty])).toEqual([["part", "Panel 550 Wp", 4], ["part", "Inverter on-grid 2000 W", 1],
      ["part", "Kabel PV 4 mm", 30], ["part", "Pembatas ekspor", 1], ["part", "Rail aluminium", 6], ["jasa", "Jasa (estimasi dari simulasi)", 1]])
    expect(items.at(-1)!.unit_price).toBe(5400000)
  })

  it("admin membuat client dan proyek langsung di Planning dengan password sementara", async () => {
    const r = await call("POST", "/api/admin/projects", { as: admin, body: { name: "PLTS 3 kW", address: "Jl. Melati 2", city: "Cimahi",
      client: { name: "Pak Joko", email: "joko@tes.id", whatsapp: "081300001111" } } })
    expect(r.status).toBe(201)
    expect(r.json.temporary_password).toHaveLength(12)
    const u = (await one(pool, "select role, must_change_password from users where email = 'joko@tes.id'"))!
    expect(u).toEqual({ role: "client", must_change_password: true })
    expect((await one(pool, "select s.system_key from projects p join project_statuses s on s.id = p.status_id where p.id = $1", [r.json.project.id]))!.system_key).toBe("planning")
    // proyek kedua untuk client yang sama
    const r2 = await call("POST", "/api/admin/projects", { as: admin, body: { name: "PLTS 2 kW", address: "Jl. Melati 3", city: "Cimahi", client_id: r.json.project.client_id } })
    expect(r2.status).toBe(201)
    expect(r2.json.temporary_password).toBeUndefined()
  })
})

describe("B5 status pengerjaan", () => {
  it("update status dengan catatan dan foto, sub-status harus milik status utamanya, riwayat tidak bisa diubah", async () => {
    const { project, session } = await acceptedClient()
    const onProgress = await statusId("on_progress"), planning = await statusId("planning")
    const sub = (await one(pool, "select id from project_sub_statuses where status_id = $1 order by sort_order limit 1", [onProgress]))!.id
    const post = (body: Record<string, unknown>) => call("POST", `/api/admin/projects/${project.id}/status-updates`, { as: admin, body })
    expect((await post({ status_id: onProgress, sub_status_id: sub })).status).toBe(400) // pindah manual wajib catatan
    expect((await post({ status_id: planning, sub_status_id: sub, note: "x" })).status).toBe(400) // sub-status bukan milik Planning
    const photo = (await upload(project.id, "foto_status")).json.file
    const r = await post({ status_id: onProgress, sub_status_id: sub, note: "Mulai belanja part", photo_file_ids: [photo.id] })
    expect(r.status).toBe(201)
    expect((await post({ note: "Part sudah dipesan" })).status).toBe(201) // catatan tanpa ganti status
    const st = (await call("GET", `/api/projects/${project.id}/status`, { as: session })).json
    expect(st.project).toMatchObject({ status_key: "on_progress", sub_status_name: "Pembelian Part" })
    expect(st.history[0]).toMatchObject({ note: "Part sudah dipesan", status_name: "On Progress" })
    expect(st.history[1].photo_file_ids).toEqual([photo.id])
    expect(st.project.stages.map((s: any) => s.status_key)).toEqual(["planning", "menunggu_pembayaran", "on_progress", "selesai"])
    expect((await call("GET", `/api/files/${photo.id}`, { as: session })).buf!.equals(PNG)).toBe(true)
    await expect(pool.query("update status_updates set note = 'diubah' where project_id = $1", [project.id])).rejects.toThrow(/tidak boleh diubah/)
    await expect(pool.query("delete from status_updates where project_id = $1", [project.id])).rejects.toThrow(/tidak boleh diubah/)
  })

})

describe("B5 data Home", () => {
  it("angka bukti tampil hanya kalau proyek selesai minimal 3", async () => {
    expect((await call("GET", "/api/home/stats")).json).toEqual({ show: false })
    const selesai = await statusId("selesai")
    await pool.query("update projects set status_id = $1, sub_status_id = null, installed_kwp = 2.2 where id in (select id from projects order by created_at limit 3)", [selesai])
    expect((await call("GET", "/api/home/stats")).json).toEqual({ show: true, finished_projects: 3, installed_kwp: 6.6 })
  })
})

describe("B5 lokasi pemasangan", () => {
  it("titik lokasi dari peta tersimpan saat mengajukan dan bisa dikoreksi admin; latitude dan longitude harus lengkap dan valid", async () => {
    const g = await userSession(call, "guest")
    const sim = await saveSim(g)
    const body = { address: "Jl. Mawar 1", city: "Purwakarta" }
    expect((await call("POST", `/api/simulations/${sim.id}/submit`, { as: g, body: { ...body, latitude: -6.55 } })).status).toBe(400)
    expect((await call("POST", `/api/simulations/${sim.id}/submit`, { as: g, body: { ...body, latitude: 95, longitude: 107.4 } })).status).toBe(400)
    const p = (await call("POST", `/api/simulations/${sim.id}/submit`, { as: g, body: { ...body, latitude: -6.5569, longitude: 107.4431 } })).json.project
    expect(p).toMatchObject({ latitude: -6.5569, longitude: 107.4431 })
    expect((await call("GET", `/api/admin/projects/${p.id}`, { as: admin })).json.project).toMatchObject({ latitude: -6.5569, longitude: 107.4431 })
    const moved = await call("PATCH", `/api/admin/projects/${p.id}`, { as: admin, body: { latitude: -6.56, longitude: 107.44 } })
    expect(moved.json.project).toMatchObject({ latitude: -6.56, longitude: 107.44 })
    // tanpa lokasi tetap boleh
    expect((await call("PATCH", `/api/admin/projects/${p.id}`, { as: admin, body: { latitude: null, longitude: null } })).json.project.latitude).toBeNull()
  })
})
