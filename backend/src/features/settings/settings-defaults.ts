import type { Db } from "../../core/db.js"
import { SETTINGS } from "./settings.js"

// Data awal: nilai Pengaturan dari PRD 11.3 dan enam status bawaan dari PRD 9.1.
// Dipakai tes sekarang dan seed lengkap setelah B7. Aman dijalankan berulang.
export const STATUSES = [
  { key: "pengajuan", name: "Pengajuan", show: false, subs: [] },
  { key: "planning", name: "Planning", show: true, subs: [] },
  { key: "menunggu_pembayaran", name: "Menunggu Pembayaran", show: true, subs: [] },
  { key: "on_progress", name: "On Progress", show: true, subs: ["Pembelian Part", "Part Dikirim", "Pengetesan Part"] },
  { key: "selesai", name: "Selesai", show: true, subs: [] },
  { key: "ditolak", name: "Ditolak", show: false, subs: [] },
]

export async function seedDefaults(db: Db) {
  for (const [key, d] of Object.entries(SETTINGS))
    await db.query("insert into settings (key, value) values ($1, $2) on conflict (key) do nothing", [key, JSON.stringify(d.value)])
  for (const [i, s] of STATUSES.entries()) {
    const row = (await db.query(`insert into project_statuses (name, system_key, show_to_client, sort_order) values ($1, $2, $3, $4)
      on conflict (system_key) do nothing returning id`, [s.name, s.key, s.show, i + 1])).rows[0]
    if (row) for (const [j, name] of s.subs.entries())
      await db.query("insert into project_sub_statuses (status_id, name, sort_order) values ($1, $2, $3)", [row.id, name, j + 1])
  }
}
