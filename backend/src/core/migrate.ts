import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type pg from "pg"
import { pool } from "./db.js"

// Struktur tabel hanya diubah lewat file SQL di backend/migrations (PRD bagian 14).
const dir = new URL("../../migrations/", import.meta.url)

export async function migrate(db: pg.Pool) {
  await db.query("create table if not exists schema_migrations (name varchar(255) primary key, applied_at timestamptz not null default now())")
  const done = new Set((await db.query("select name from schema_migrations")).rows.map(r => r.name))
  const ran: string[] = []
  for (const name of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue
    const c = await db.connect()
    try {
      await c.query("begin")
      await c.query(readFileSync(new URL(name, dir), "utf8"))
      await c.query("insert into schema_migrations (name) values ($1)", [name])
      await c.query("commit")
      ran.push(name)
    } catch (e) {
      await c.query("rollback")
      throw e
    } finally {
      c.release()
    }
  }
  return ran
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ran = await migrate(pool)
  console.log(ran.length ? `Migrasi dijalankan: ${ran.join(", ")}` : "Tidak ada migrasi baru")
  await pool.end()
}
