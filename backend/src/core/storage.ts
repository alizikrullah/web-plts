import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { directus, directusToken } from "./directus.js"

// Penyimpanan file privat. Normalnya di Directus (PRD bagian 14 aturan 4); STORAGE_DIR dipakai tes
// supaya tes tidak mengisi Directus. storage_key tidak pernah dikirim ke browser.
const dir = () => process.env.STORAGE_DIR

export async function putFile(buf: Buffer, name: string, mime: string): Promise<string> {
  if (dir()) {
    mkdirSync(dir()!, { recursive: true })
    const key = randomUUID()
    writeFileSync(join(dir()!, key), buf)
    return key
  }
  const boundary = "----plts" + randomUUID()
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodeURIComponent(name)}"\r\nContent-Type: ${mime}\r\n\r\n`),
    buf, Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const r = await directus("/files", { method: "POST", token: await directusToken(), raw: body, type: `multipart/form-data; boundary=${boundary}` })
  if (r.status !== 200) throw new Error(`Unggah ke Directus gagal (${r.status})`)
  return r.json.data.id
}

export async function getFile(key: string): Promise<Buffer> {
  if (dir()) return readFileSync(join(dir()!, key.replace(/[^\w-]/g, "")))
  const r = await directus(`/assets/${encodeURIComponent(key)}`, { token: await directusToken() })
  if (r.status !== 200) throw new Error(`Ambil file dari Directus gagal (${r.status})`)
  return r.buf
}
