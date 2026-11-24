import type { AddressInfo } from "node:net"
import { app } from "../app.js"
import { connect, pool } from "../core/db.js"
import { migrate } from "../core/migrate.js"
import { hashPassword } from "../core/tokens.js"

// Tes otomatis memakai database terpisah yang dibangun ulang dari nol lewat migrasi, supaya data yang dipakai
// Directus tidak tersentuh: plts_test untuk tes backend, plts_e2e untuk tes lewat layar di frontend.
export async function freshTestDb() {
  const db = process.env.PGDATABASE
  if (db !== "plts_test" && db !== "plts_e2e") throw new Error("Tes harus memakai database plts_test atau plts_e2e")
  const admin = connect("postgres")
  await admin.query(`drop database if exists ${db} with (force)`)
  await admin.query(`create database ${db}`)
  await admin.end()
  await migrate(pool)
  return pool
}

// Menjalankan app di port acak dan memberi pembantu untuk memanggil API seperti browser.
export async function startApp() {
  const server = app.listen(0)
  await new Promise(r => server.once("listening", r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, close: () => new Promise(r => server.close(r)) }
}

export interface Session { token?: string; cookie?: string }
export function client(base: string) {
  return async function call(method: string, path: string, opt: { body?: unknown; as?: Session; raw?: Buffer; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...opt.headers }
    if (opt.body !== undefined) headers["content-type"] = "application/json"
    if (opt.as?.token) headers.authorization = `Bearer ${opt.as.token}`
    if (opt.as?.cookie) headers.cookie = opt.as.cookie
    const res = await fetch(base + path, { method, headers, body: opt.raw ? new Uint8Array(opt.raw) : opt.body === undefined ? undefined : JSON.stringify(opt.body) })
    const setCookie = res.headers.get("set-cookie")
    if (opt.as && setCookie) opt.as.cookie = setCookie.split(";")[0]
    const type = res.headers.get("content-type") ?? ""
    const json = type.includes("json") ? await res.json() : null
    const buf = json ? null : Buffer.from(await res.arrayBuffer())
    if (opt.as && json?.access_token) opt.as.token = json.access_token
    return { status: res.status, json, buf, headers: res.headers }
  }
}

// Membuat user langsung ke database lalu masuk lewat API.
let n = 0
export async function userSession(call: ReturnType<typeof client>, role: "guest" | "client" | "admin", extra: { must_change_password?: boolean } = {}) {
  const email = `${role}${++n}@tes.id`
  await pool.query(`insert into users (name, email, whatsapp, password_hash, role, must_change_password, became_client_at, is_verified)
    values ($1, $2, '6281200000000', $3, $4::varchar, $5, case when $4::varchar = 'client' then now() end, true)`,
    [`${role} ${n}`, email, await hashPassword("password-tes"), role, extra.must_change_password ?? false])
  const s: Session & { id?: string; email?: string } = { email }
  const r = await call("POST", "/api/auth/login", { body: { email, password: "password-tes" }, as: s })
  if (r.status !== 200) throw new Error("Login tes gagal: " + JSON.stringify(r.json))
  s.id = r.json.user.id
  return s as Session & { id: string; email: string }
}

// Teks di dalam PDF (tagihan), untuk memastikan isi yang dilihat client.
export async function pdfText(buf: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const doc = await getDocument({ data: new Uint8Array(buf), isEvalSupported: false, verbosity: 0 }).promise
  let text = ""
  for (let n = 1; n <= doc.numPages; n++) text += (await (await doc.getPage(n)).getTextContent()).items.map((i: any) => i.str).join(" ") + "\n"
  await doc.destroy()
  return text.replace(/\s+/g, " ")
}
