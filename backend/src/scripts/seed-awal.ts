import { pool } from "../core/db.js"
import { seedDefaults } from "../features/settings/settings-defaults.js"

// Data awal (PRD 19.3): nilai awal Pengaturan dan enam status bawaan. Yang sudah ada tidak ditimpa.
// Nilai bertanda "Diisi tim" disimpan kosong (null) dan diisi tim lewat Pengaturan.
await seedDefaults(pool)
const empty = (await pool.query("select key from settings where value = 'null'::jsonb order by key")).rows.map(r => r.key)
console.log("Data awal siap. Pengaturan yang masih harus diisi tim: " + (empty.join(", ") || "tidak ada"))
await pool.end()
