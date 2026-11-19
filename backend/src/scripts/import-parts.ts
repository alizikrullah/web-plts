import { readFileSync } from "node:fs"
import { one, pool, tx } from "../core/db.js"
import { insertPart, readPart } from "../features/parts/parts.js"

// Impor data awal List Part dari file JSON (PRD 11.2 aturan 6). Part dengan nama yang sudah ada dilewati.
// Pemakaian: npm run import:parts -- data/parts-awal.json
const file = process.argv[2]
if (!file) {
  console.log("Pemakaian: npm run import:parts -- data/parts-awal.json")
  process.exit(1)
}
const rows = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>[]
const parts = rows.map(readPart) // semua baris diperiksa dulu sebelum ada yang disimpan
const added = await tx(async c => {
  let n = 0
  for (const p of parts) if (!(await one(c, "select 1 from parts where name = $1", [p.name])) && ++n) await insertPart(c, p)
  return n
})
console.log(`${added} part ditambahkan, ${parts.length - added} sudah ada`)
await pool.end()
