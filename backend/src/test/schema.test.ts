import { readFileSync } from "node:fs"
import type pg from "pg"
import { afterAll, beforeAll, expect, it } from "vitest"
import { connect } from "../core/db.js"
import { directus } from "../core/directus.js"
import { freshTestDb } from "./test-db.js"

const pool = connect("directus") // database yang dipakai Directus

// Harapan diambil langsung dari tabel di PRD bagian 17, supaya PRD dan database tidak bisa berbeda diam-diam.
const prd = readFileSync(new URL("../../../PRD dan ERD Web PLTS.md", import.meta.url), "utf8")
const section = prd.slice(prd.indexOf("### 17.1"), prd.indexOf("### 17.4"))

const TYPES: Record<string, string> = {
  PK: "uuid", FK: "uuid", varchar: "character varying", text: "text", int: "integer", bigint: "bigint", decimal: "numeric",
  boolean: "boolean", enum: "character varying", timestamp: "timestamp with time zone", date: "date", json: "jsonb",
}
interface Col { type: string; nullable: boolean; pk: boolean; fk: string | null; isEnum: boolean }
const expected: Record<string, Record<string, Col>> = {}
let table = ""
for (const line of section.split("\n")) {
  const head = line.match(/^\*\*([a-z\\_]+)\*\*:/)
  if (head) { table = head[1].replaceAll("\\", ""); expected[table] = {}; continue }
  const cells = line.split("|").map(c => c.trim().replaceAll("\\", ""))
  if (cells.length !== 5 || cells[1] === "Kolom" || cells[1].startsWith("---")) continue
  const [, nameCell, typeCell, note] = cells
  const names = nameCell.split(", "), types = typeCell.split(", ")
  const named = names.filter(n => new RegExp(`${n}[^.]*boleh kosong`).test(note))
  names.forEach((name, i) => {
    const t = names.length > 1 && types.length === names.length ? types[i] : typeCell
    const pk = /\bPK\b/.test(t), fk = t.match(/^FK (\w+)/)
    expected[table][name] = {
      type: TYPES[pk ? (t === "PK" ? "PK" : t.split(", ")[0]) : fk ? "FK" : t], pk, fk: fk?.[1] ?? null, isEnum: t === "enum",
      nullable: named.length ? named.includes(name) : /boleh kosong|kosong untuk type lain|^Hanya (panel|inverter|baterai)|^Inverter dan baterai/i.test(note),
    }
  })
}
const tables = Object.keys(expected)

// Gambaran lengkap struktur: kolom, batasan, dan indeks.
async function snapshot(db: pg.Pool) {
  const all = [...tables, "schema_migrations"]
  const q = async (sql: string) => (await db.query(sql, [all])).rows
  return {
    columns: await q(`select table_name, column_name, data_type, character_maximum_length, is_nullable, column_default
      from information_schema.columns where table_schema = 'public' and table_name = any($1) order by 1, 2`),
    constraints: await q(`select c.relname, n.conname, pg_get_constraintdef(n.oid) def from pg_constraint n join pg_class c on c.oid = n.conrelid
      where c.relnamespace = 'public'::regnamespace and c.relname = any($1) order by 1, 2`),
    indexes: await q(`select tablename, indexdef from pg_indexes where schemaname = 'public' and tablename = any($1) order by 1, 2`),
  }
}

let db: pg.Pool
beforeAll(async () => { db = await freshTestDb() })
afterAll(async () => { await db.end(); await pool.end() })

it("PRD bagian 17 memuat 23 tabel", () => {
  expect(tables).toHaveLength(23)
})

it("tabel, kolom, tipe, wajib isi, PK, dan FK di database sama dengan PRD bagian 17", async () => {
  const s = await snapshot(db)
  const fks = (await db.query(`select c.relname t, a.attname col, f.relname ref from pg_constraint n
    join pg_class c on c.oid = n.conrelid join pg_class f on f.oid = n.confrelid
    join pg_attribute a on a.attrelid = n.conrelid and a.attnum = any(n.conkey) where n.contype = 'f'`)).rows
  const pks = (await db.query(`select c.relname t, a.attname col from pg_constraint n join pg_class c on c.oid = n.conrelid
    join pg_attribute a on a.attrelid = n.conrelid and a.attnum = any(n.conkey) where n.contype = 'p'`)).rows
  const actual: typeof expected = {}
  for (const c of s.columns) {
    if (c.table_name === "schema_migrations") continue
    const checks = s.constraints.filter(k => k.relname === c.table_name && k.def.startsWith("CHECK") && k.def.includes(`(${c.column_name})::text = ANY`))
    ;(actual[c.table_name] ??= {})[c.column_name] = {
      type: c.data_type, nullable: c.is_nullable === "YES",
      pk: pks.some(p => p.t === c.table_name && p.col === c.column_name),
      fk: fks.find(f => f.t === c.table_name && f.col === c.column_name && (f.col !== "sub_status_id" || f.ref === "project_sub_statuses"))?.ref ?? null,
      // kolom enum wajib punya batasan nilai; varchar biasa boleh juga punya (misalnya system_key)
      isEnum: checks.length > 0 && expected[c.table_name]?.[c.column_name]?.isEnum === true,
    }
    if (c.data_type === "character varying") expect(c.character_maximum_length, `${c.table_name}.${c.column_name}`).toBe(255)
  }
  expect(actual).toEqual(expected)
})

it("aturan 18.6: satu planning dan satu tagihan awal yang tidak batal per proyek dijaga database", async () => {
  const { indexes } = await snapshot(db)
  const defs = indexes.map(i => i.indexdef).join("\n")
  expect(defs).toMatch(/UNIQUE INDEX \w+ ON public\.plannings USING btree \(project_id\)/)
  expect(defs).toMatch(/UNIQUE INDEX invoices_satu_tagihan_awal ON public\.invoices USING btree \(project_id\) WHERE/)
})

it("Directus membaca semua tabel tanpa mengubah strukturnya", async () => {
  const fresh = await snapshot(db)
  expect(await snapshot(pool), "database Directus harus sama dengan hasil migrasi dari nol").toEqual(fresh)

  const login = await directus("/auth/login", { method: "POST", body: { email: process.env.DIRECTUS_ADMIN_EMAIL, password: process.env.DIRECTUS_ADMIN_PASSWORD } })
  expect(login.status).toBe(200)
  const token = login.json.data.access_token
  await directus("/utils/cache/clear", { method: "POST", token })
  const seen = (await directus("/collections", { token })).json.data.map((c: any) => c.collection)
  expect(seen).toEqual(expect.arrayContaining(tables))
  for (const t of tables) expect((await directus(`/items/${t}?limit=1`, { token })).status, t).toBe(200)

  // role tim hanya boleh membaca tabel aplikasi
  const role = (await directus("/roles?filter[name][_eq]=Tim%20(lihat%20saja)&fields=policies.policy.id,policies.policy.admin_access", { token })).json.data
  expect(role).toHaveLength(1)
  const [{ policy }] = role[0].policies
  expect(policy.admin_access).toBe(false)
  const perms = (await directus(`/permissions?filter[policy][_eq]=${policy.id}&limit=-1&fields=collection,action`, { token })).json.data
  expect(new Set(perms.map((p: any) => p.action))).toEqual(new Set(["read"]))
  expect(perms.map((p: any) => p.collection).sort()).toEqual([...tables].sort())

  expect(await snapshot(pool), "struktur berubah setelah dibaca Directus").toEqual(fresh)
})
