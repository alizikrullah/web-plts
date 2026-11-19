import { all, one, type Db } from "../../core/db.js"

// Pembantu Planning (PRD 7.4). Total selalu dihitung dari baris biaya, tidak dipercaya dari browser.
export const subtotal = (qty: number, unitPrice: number, days: number | null) => Math.round(qty * unitPrice * (days ?? 1))

export async function recalcPlanning(db: Db, planningId: string) {
  return one(db, `update plannings p set
      total_parts = t.part, total_labor = t.sdm, total_services = t.jasa, total_accommodation = t.akomodasi,
      grand_total = t.part + t.sdm + t.jasa + t.akomodasi
    from (select
      coalesce(sum(subtotal) filter (where type = 'part'), 0) part, coalesce(sum(subtotal) filter (where type = 'sdm'), 0) sdm,
      coalesce(sum(subtotal) filter (where type = 'jasa'), 0) jasa, coalesce(sum(subtotal) filter (where type = 'akomodasi'), 0) akomodasi
      from planning_items where planning_id = $1) t
    where p.id = $1 returning p.*`, [planningId])
}

// Planning dimulai dari simulasi yang disetujui: panel, inverter, dan baterai terisi otomatis
// dengan harga satuan dari List Part saat ini (PRD 7.4 aturan 1).
export async function createPlanning(db: Db, project: { id: string; simulation_id: string | null }, userId: string) {
  const planning = (await one(db, "insert into plannings (project_id, created_by) values ($1, $2) returning *", [project.id, userId]))!
  if (project.simulation_id) {
    const sim = (await one(db, "select * from simulations where id = $1", [project.simulation_id]))!
    const lines = [[sim.panel_part_id, sim.panel_qty], [sim.inverter_part_id, 1], [sim.battery_part_id, sim.battery_qty]].filter(([id, q]) => id && q > 0)
    for (const [i, [partId, qty]] of lines.entries()) {
      const part = (await one(db, "select id, name, unit, unit_price from parts where id = $1", [partId]))!
      await db.query(`insert into planning_items (planning_id, type, part_id, description, unit, qty, unit_price, subtotal, sort_order)
        values ($1, 'part', $2, $3, $4, $5, $6, $7, $8)`, [planning.id, part.id, part.name, part.unit, qty, part.unit_price, subtotal(qty, part.unit_price, null), i + 1])
    }
  }
  return recalcPlanning(db, planning.id)
}

export const planningItems = (db: Db, planningId: string) =>
  all(db, "select * from planning_items where planning_id = $1 order by sort_order, description", [planningId])
