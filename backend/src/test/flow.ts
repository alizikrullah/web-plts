import { one, pool } from "../core/db.js"
import type { PartKey } from "./test-data.js"
import { userSession, type client, type Session } from "./test-db.js"

// Pembantu tes: menjalankan alur proyek lewat API sampai tahap tertentu.
type Call = ReturnType<typeof client>
// PNG 1x1 yang valid
export const PNG: Buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")

export function flow(call: Call, admin: Session, ids: Record<PartKey, string>) {
  const ok = async (r: Promise<{ status: number; json: any }>, want = [200, 201]) => {
    const x = await r
    if (!want.includes(x.status)) throw new Error(`${x.status} ${JSON.stringify(x.json)}`)
    return x.json
  }
  const f = {
    upload: (projectId: string, purpose: string, buf: Buffer = PNG, type = "image/png", name = "file.png") =>
      ok(call("POST", `/api/admin/projects/${projectId}/files?purpose=${purpose}`, { as: admin, raw: buf, headers: { "content-type": type, "x-filename": name } })).then(j => j.file),
    // Guest menyimpan simulasi lalu mengajukan. Proyeknya berstatus Pengajuan.
    async submitted() {
      const g = await userSession(call, "guest")
      const sim = (await ok(call("POST", "/api/simulations", { as: g, body: { system_type: "hybrid_offgrid", pln_power_va: 2200, monthly_bill: 1000000,
        usage_pattern: "seimbang", panel_part_id: ids.panel550, panel_qty: 4, inverter_part_id: ids.inv3000, battery_part_id: ids.bat24, battery_qty: 1 } }))).simulation
      const project = (await ok(call("POST", `/api/simulations/${sim.id}/submit`, { as: g, body: { address: "Jl. Mawar 1", city: "Bandung" } }))).project
      return { session: g, project, sim }
    },
    // Pengajuan diterima admin: guest menjadi client dengan proyek di Planning.
    async accepted() {
      const s = await f.submitted()
      await ok(call("POST", `/api/admin/projects/${s.project.id}/accept`, { as: admin }))
      await call("POST", "/api/auth/refresh", { as: s.session })
      return s
    },
    // Planning ditambah SDM, jasa, dan akomodasi, lalu final.
    async finalPlanning(projectId: string, extra: Record<string, unknown>[] = []) {
      const cur = (await ok(call("GET", `/api/admin/projects/${projectId}/planning`, { as: admin })))
      const items = [...cur.items.map((i: any) => ({ type: i.type, part_id: i.part_id, qty: i.qty, unit_price: i.unit_price, description: i.description, days: i.days })),
        { type: "sdm", qty: 3, days: 2 }, { type: "jasa", description: "Instalasi dan setting inverter", unit_price: 2500000 },
        { type: "akomodasi", description: "Transport tim", unit_price: 300000 }, ...extra]
      await ok(call("PUT", `/api/admin/projects/${projectId}/planning`, { as: admin, body: { site_notes: "Atap genteng, jarak ke panel 15 m", items } }))
      return (await ok(call("POST", `/api/admin/projects/${projectId}/planning/finalize`, { as: admin, body: {} }))).planning
    },
    issue: (projectId: string) => ok(call("POST", `/api/admin/projects/${projectId}/invoices`, { as: admin, body: {} })).then(j => j.invoice),
    pay: (invoiceId: string, amount: number, paid_at = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)) =>
      ok(call("POST", `/api/admin/invoices/${invoiceId}/payments`, { as: admin, body: { amount, paid_at, method: "Transfer" } })),
    // Proyek sampai On Progress: diterima, planning final, tagihan awal lunas.
    async onProgress() {
      const a = await f.accepted()
      await f.finalPlanning(a.project.id)
      const invoice = await f.issue(a.project.id)
      await f.pay(invoice.id, invoice.total)
      return { ...a, invoice }
    },
    statusKey: async (projectId: string) =>
      (await one(pool, "select s.system_key from projects p join project_statuses s on s.id = p.status_id where p.id = $1", [projectId]))!.system_key,
  }
  return f
}
