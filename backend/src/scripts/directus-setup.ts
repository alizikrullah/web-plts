import { readdirSync, readFileSync } from "node:fs"
import { directus } from "../core/directus.js"

// Mendaftarkan tabel aplikasi sebagai collection Directus dan membuat role tim yang hanya bisa melihat
// (PRD bagian 14). Hanya menulis ke tabel sistem Directus; struktur tabel aplikasi tidak disentuh.
// Aman dijalankan berulang.
const dir = new URL("../../migrations/", import.meta.url)
const tables = readdirSync(dir).filter(f => f.endsWith(".sql"))
  .flatMap(f => [...readFileSync(new URL(f, dir), "utf8").matchAll(/^create table (\w+)/gm)].map(m => m[1]))
const NOTE = "Hanya untuk dilihat. Data diubah lewat web."
const ROLE = "Tim (lihat saja)"

const login = await directus("/auth/login", {
  method: "POST", body: { email: process.env.DIRECTUS_ADMIN_EMAIL, password: process.env.DIRECTUS_ADMIN_PASSWORD },
})
if (login.status !== 200) throw new Error(`Login admin Directus gagal (${login.status})`)
const token = login.json.data.access_token
const ok = async (r: Promise<{ status: number; json: any }>) => {
  const res = await r
  if (res.status >= 300) throw new Error(JSON.stringify(res.json))
  return res.json?.data
}

for (const t of tables) {
  const c = await ok(directus(`/collections/${t}`, { token }))
  if (!c.meta) await ok(directus(`/collections/${t}`, { method: "PATCH", token, body: { meta: { note: NOTE } } }))
}

const read = (collection: string) => ({ collection, action: "read", fields: ["*"], permissions: {}, validation: {} })
const found = await ok(directus(`/roles?filter[name][_eq]=${encodeURIComponent(ROLE)}&fields=id,policies.policy.id`, { token }))
if (!found.length) {
  const policy = await ok(directus("/policies", { method: "POST", token, body: {
    name: ROLE, icon: "visibility", admin_access: false, app_access: true, permissions: tables.map(read),
  } }))
  await ok(directus("/roles", { method: "POST", token, body: { name: ROLE, icon: "visibility", policies: [{ policy: policy.id }] } }))
} else {
  // Role sudah ada: tabel dari migrasi baru ikut diberi izin baca.
  const policy = found[0].policies[0].policy.id
  const has = new Set((await ok(directus(`/permissions?filter[policy][_eq]=${policy}&limit=-1&fields=collection`, { token }))).map((p: any) => p.collection))
  for (const t of tables.filter(t => !has.has(t))) await ok(directus("/permissions", { method: "POST", token, body: { ...read(t), policy } }))
}
console.log(`${tables.length} tabel terdaftar di Directus, role "${ROLE}" siap`)
