import http from "node:http"
import https from "node:https"
import "./db.js" // memuat .env

// Directus hanya dipanggil dari backend (PRD bagian 14). DIRECTUS_CONNECT_HOST dipakai kalau
// alamat di DIRECTUS_URL tidak bisa dibuka dari mesin ini (misalnya dari jaringan yang sama dengan server).
export function directus(path: string, opt: { method?: string; token?: string; body?: unknown; raw?: Buffer; type?: string } = {}) {
  const url = new URL(path, process.env.DIRECTUS_URL)
  const body = opt.raw ?? (opt.body === undefined ? undefined : Buffer.from(JSON.stringify(opt.body)))
  const type = opt.type ?? (opt.body === undefined ? undefined : "application/json")
  return new Promise<{ status: number; json: any; buf: Buffer }>((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request({
      host: process.env.DIRECTUS_CONNECT_HOST || url.hostname, port: url.port || undefined, path: url.pathname + url.search,
      method: opt.method ?? "GET", servername: url.hostname,
      headers: { host: url.host, ...(type && { "content-type": type }), ...(opt.token && { authorization: `Bearer ${opt.token}` }) },
    }, res => {
      const chunks: Buffer[] = []
      res.on("data", d => chunks.push(d)).on("end", () => {
        const buf = Buffer.concat(chunks)
        let json: any = null
        if ((res.headers["content-type"] ?? "").includes("json")) try { json = JSON.parse(buf.toString()) } catch { /* bukan JSON */ }
        resolve({ status: res.statusCode!, json, buf })
      })
    })
    req.on("error", reject).end(body)
  })
}

// Token admin Directus disimpan sebentar di memori dan diminta ulang kalau kedaluwarsa.
let cached: { token: string; until: number } | null = null
export async function directusToken() {
  if (cached && cached.until > Date.now()) return cached.token
  const r = await directus("/auth/login", { method: "POST", body: { email: process.env.DIRECTUS_ADMIN_EMAIL, password: process.env.DIRECTUS_ADMIN_PASSWORD } })
  if (r.status !== 200) throw new Error(`Login Directus gagal (${r.status})`)
  cached = { token: r.json.data.access_token, until: Date.now() + Math.max(0, r.json.data.expires - 60000) }
  return cached.token
}
