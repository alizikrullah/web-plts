import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pool } from "../../core/db.js"
import { flow } from "../../test/flow.js"
import { seedTestData } from "../../test/test-data.js"
import { client, freshTestDb, startApp, userSession, type Session } from "../../test/test-db.js"

let app: Awaited<ReturnType<typeof startApp>>, call: ReturnType<typeof client>, admin: Session, f: ReturnType<typeof flow>
beforeAll(async () => {
  await freshTestDb(); const ids = await seedTestData()
  app = await startApp(); call = client(app.base); admin = await userSession(call, "admin"); f = flow(call, admin, ids)
})
afterAll(async () => { await app.close(); await pool.end() })

describe("B5 data Home admin", () => {
  it("Status Client bulanan dihitung dari riwayat, Perlu Tindakan menampilkan pengajuan baru", async () => {
    // Data bulan ini: empat proyek di Planning dan satu pengajuan yang ditolak.
    for (let i = 0; i < 4; i++) await f.accepted()
    const rejected = await f.submitted()
    await call("POST", `/api/admin/projects/${rejected.project.id}/reject`, { as: admin, body: { reason: "Di luar area layanan" } })
    const month = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
    const rows = (await call("GET", `/api/admin/home/status-bulanan?month=${month}`, { as: admin })).json.rows
    expect(rows.length).toBeGreaterThan(3)
    expect(rows.some((r: any) => r.status_key === "ditolak")).toBe(true)
    expect(rows.every((r: any) => r.status_key !== "ditolak" || r.last_update_at)).toBe(true)
    // bulan sebelum ada proyek: kosong
    expect((await call("GET", "/api/admin/home/status-bulanan?month=2020-01", { as: admin })).json.rows).toEqual([])
    const planning = (await call("GET", `/api/admin/home/status-bulanan?month=${month}&status=planning`, { as: admin })).json.rows
    expect(planning.every((r: any) => r.status_key === "planning")).toBe(true)

    const p = (await f.submitted()).project
    const todo = (await call("GET", "/api/admin/home/perlu-tindakan?all=true", { as: admin })).json
    expect(todo.items.some((i: any) => i.reason === "pengajuan_baru" && i.project_id === p.id)).toBe(true)
    // proyek yang terlalu lama di Planning muncul setelah lewat ambang 7 hari
    const old = await f.accepted()
    await pool.query("alter table status_updates disable trigger status_updates_tetap")
    await pool.query("update status_updates set created_at = now() - interval '8 days' where project_id = $1", [old.project.id])
    await pool.query("alter table status_updates enable trigger status_updates_tetap")
    const todo2 = (await call("GET", "/api/admin/home/perlu-tindakan?all=true", { as: admin })).json
    expect(todo2.items.some((i: any) => i.reason === "planning_belum_final" && i.project_id === old.project.id)).toBe(true)
    expect((await call("GET", "/api/admin/home/perlu-tindakan", { as: admin })).json.items.length).toBeLessThanOrEqual(8)
  })
})
