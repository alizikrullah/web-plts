import type { Request } from "express"
import { all, one, type Db } from "../../core/db.js"
import { fail, v } from "../../core/http.js"

// Pembantu bersama untuk proyek, status, dan nomor dokumen.

// Aturan 18.1: client hanya boleh membaca proyek miliknya. Proyek orang lain dijawab "tidak ditemukan".
export async function projectFor(db: Db, req: Request, id: string, lock = false) {
  const p = await one(db, `select * from projects where id = $1 and ($2 or client_id = $3) ${lock ? "for update" : ""}`,
    [id, req.user!.role === "admin", req.user!.sub])
  return p ?? fail(404, "Proyek tidak ditemukan", "NOT_FOUND")
}

export async function statusByKey(db: Db, key: string) {
  return (await one(db, "select * from project_statuses where system_key = $1", [key])) ?? fail(500, `Status bawaan ${key} belum ada`, "SETTINGS_MISSING")
}
export async function statusKeyOf(db: Db, project: { status_id: string }) {
  return (await one(db, "select system_key from project_statuses where id = $1", [project.status_id]))!.system_key as string | null
}

// Mengganti status proyek dan mencatat riwayatnya (aturan 18.5: status_updates adalah riwayat yang sebenarnya).
export async function setStatus(db: Db, projectId: string, statusId: string, subStatusId: string | null, note: string | null, userId: string) {
  await db.query("update projects set status_id = $2, sub_status_id = $3 where id = $1", [projectId, statusId, subStatusId])
  return one(db, "insert into status_updates (project_id, status_id, sub_status_id, note, created_by) values ($1, $2, $3, $4, $5) returning *",
    [projectId, statusId, subStatusId, note, userId])
}
export async function moveTo(db: Db, projectId: string, key: string, note: string | null, userId: string) {
  const s = await statusByKey(db, key)
  // On Progress dimulai dari sub-status aktif pertama (PRD bagian 3).
  const sub = key === "on_progress"
    ? await one(db, "select id from project_sub_statuses where status_id = $1 and is_active order by sort_order, name limit 1", [s.id]) : null
  return setStatus(db, projectId, s.id, sub?.id ?? null, note, userId)
}

// Nomor dokumen PREFIX-TAHUN-NOMOR, nomor urut mulai lagi dari 001 tiap tahun (asumsi 11). Tahun memakai WIB.
export async function nextNumber(db: Db, table: "projects" | "invoices", column: "code" | "number", prefix: string) {
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [table + "." + column])
  const year = (await one(db, "select extract(year from now() at time zone 'Asia/Jakarta')::int y"))!.y
  const last = await one(db, `select max(substring(${column} from '\\d+$')::int) n from ${table} where ${column} like $1`, [`${prefix}-${year}-%`])
  return `${prefix}-${year}-${String((last?.n ?? 0) + 1).padStart(3, "0")}`
}

// Tanggal hari ini dan perhitungan tanggal dalam WIB (PRD bagian 12).
export const todayWib = async (db: Db) => (await one(db, "select (now() at time zone 'Asia/Jakarta')::date d"))!.d as string
export const addDaysWib = async (db: Db, days: number) =>
  (await one(db, "select ((now() at time zone 'Asia/Jakarta')::date + $1::int) d", [days]))!.d as string

// Rekap biaya part (PRD 8.4, aturan 18.8).
export async function recap(db: Db, projectId: string) {
  const r = (await one(db, `select
    coalesce((select amount_parts from invoices where project_id = $1 and type = 'awal' and status in ('terbit', 'lunas')), 0)::bigint a,
    coalesce((select sum(amount) from cost_adjustments where project_id = $1 and category = 'part' and borne_by = 'client'
      and client_approved_at is not null and proof_file_id is not null), 0)::bigint b,
    coalesce((select sum(total_paid) from purchases where project_id = $1 and status = 'terkonfirmasi'), 0)::bigint c,
    coalesce((select sum(amount) from cost_adjustments where project_id = $1 and category = 'part' and borne_by = 'kami'), 0)::bigint d,
    coalesce((select sum(amount) from refunds where project_id = $1), 0)::bigint refunded`, [projectId]))!
  const refund_due = Math.max(0, r.a + r.b - r.c)
  return { ...r, refund_due, refund_remaining: refund_due - r.refunded, shortfall: Math.max(0, r.c - r.a - r.b - r.d) }
}

// Aturan 18.10: syarat proyek boleh ditandai Selesai, juga saat status dipindah manual.
export async function finishBlockers(db: Db, projectId: string) {
  const r = await recap(db, projectId)
  const reasons: string[] = []
  if (r.shortfall > 0) reasons.push(`Masih ada kekurangan biaya part Rp${r.shortfall.toLocaleString("id-ID")} yang belum diputuskan lewat Biaya Tambahan`)
  if (r.refunded !== r.refund_due) reasons.push(`Pengembalian ke client belum dicatat penuh: harus Rp${r.refund_due.toLocaleString("id-ID")}, tercatat Rp${r.refunded.toLocaleString("id-ID")}`)
  const unpaid = await all(db, "select number from invoices where project_id = $1 and status = 'terbit' order by number", [projectId])
  if (unpaid.length) reasons.push(`Tagihan belum lunas: ${unpaid.map(i => i.number).join(", ")}`)
  return reasons
}

// Titik lokasi pemasangan dari peta. Boleh kosong; kalau diisi, latitude dan longitude terisi bersamaan.
export function readLocation(b: Record<string, unknown>) {
  const latitude = v.optNum(b, "latitude", -90), longitude = v.optNum(b, "longitude", -180)
  if ((latitude === null) !== (longitude === null)) fail(400, "Lokasi harus berisi latitude dan longitude", "INVALID_INPUT")
  if (latitude !== null && (latitude > 90 || longitude! > 180)) fail(400, "Lokasi di luar jangkauan peta", "INVALID_INPUT")
  return { latitude, longitude }
}
