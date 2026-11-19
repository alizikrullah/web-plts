import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pool } from "../../core/db.js"
import { flow, PNG } from "../../test/flow.js"
import { seedTestData } from "../../test/test-data.js"
import { client, freshTestDb, startApp, userSession, type Session } from "../../test/test-db.js"

let app: Awaited<ReturnType<typeof startApp>>, call: ReturnType<typeof client>, admin: Session, f: ReturnType<typeof flow>
beforeAll(async () => {
  await freshTestDb(); const ids = await seedTestData()
  app = await startApp(); call = client(app.base); admin = await userSession(call, "admin"); f = flow(call, admin, ids)
})
afterAll(async () => { await app.close(); await pool.end() })

const upload = (projectId: string, purpose: string, buf: Buffer, type = "image/png") =>
  call("POST", `/api/admin/projects/${projectId}/files?purpose=${purpose}`, { as: admin, raw: buf, headers: { "content-type": type, "x-filename": "foto%20atap.png" } })

describe("B5 file proyek", () => {
  it("file hanya PDF, JPG, atau PNG yang isinya sesuai jenisnya, maksimal 10 MB", async () => {
    const { project } = await f.accepted()
    expect((await upload(project.id, "foto_status", Buffer.from("bukan gambar"), "image/png")).status).toBe(415)
    expect((await upload(project.id, "foto_status", Buffer.from("MZ..."), "application/x-msdownload")).status).toBe(415)
    expect((await upload(project.id, "tagihan_pdf", Buffer.from("%PDF-1.4"), "application/pdf")).status).toBe(400)
    expect((await upload(project.id, "foto_status", Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]))).status).toBe(413)
  })
})
