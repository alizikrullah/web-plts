import express, { Router } from "express"
import { one, pool, type Db } from "../../core/db.js"
import { auth, fail, param } from "../../core/http.js"
import { projectFor } from "../projects/projects-core.js"
import { getFile, putFile } from "../../core/storage.js"

// File privat: diunggah lewat backend dan dibuka lewat backend setelah cek pemilik (PRD bagian 12, aturan 18.1).
export const router = Router()
const MAX = 10 * 1024 * 1024
const TYPES: Record<string, (b: Buffer) => boolean> = {
  "application/pdf": b => b.subarray(0, 5).toString() === "%PDF-",
  "image/jpeg": b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
}
export const UPLOAD_PURPOSES = ["invoice_pembelian", "foto_status", "bukti_bayar", "bukti_setuju", "bukti_pengembalian"] as const
const PUBLIC_FILE = "id, project_id, purpose, original_name, mime_type, size_bytes, created_at"

export async function saveFile(db: Db, f: { buf: Buffer; name: string; mime: string; projectId: string | null; purpose: string; userId: string }) {
  const key = await putFile(f.buf, f.name, f.mime)
  return one(db, `insert into files (project_id, purpose, storage_key, original_name, mime_type, size_bytes, uploaded_by)
    values ($1, $2, $3, $4, $5, $6, $7) returning ${PUBLIC_FILE}`, [f.projectId, f.purpose, key, f.name, f.mime, f.buf.length, f.userId])
}

// Unggah satu file mentah (bukan form): Content-Type berisi jenis file, X-Filename berisi nama file.
router.post("/admin/projects/:id/files", express.raw({ type: () => true, limit: MAX }), async (req, res) => {
  const project = await projectFor(pool, req, param(req, "id"))
  const purpose = String(req.query.purpose)
  if (!UPLOAD_PURPOSES.includes(purpose as any)) fail(400, `purpose harus salah satu dari: ${UPLOAD_PURPOSES.join(", ")}`, "INVALID_INPUT")
  const mime = String(req.headers["content-type"] ?? "").split(";")[0].trim()
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  if (!TYPES[mime]) fail(415, "File harus PDF, JPG, atau PNG", "INVALID_FILE")
  if (!buf.length || !TYPES[mime](buf)) fail(415, "Isi file tidak sesuai jenisnya", "INVALID_FILE")
  let name = "file"
  try { name = decodeURIComponent(String(req.headers["x-filename"] ?? "file")).replace(/[\\/\r\n"]/g, "_").slice(0, 255) || "file" } catch { /* nama tidak valid */ }
  res.status(201).json({ file: await saveFile(pool, { buf, name, mime, projectId: project.id, purpose, userId: req.user!.sub }) })
})

// Membuka file. Client hanya file proyeknya sendiri; file pembelian baru setelah pembeliannya terkonfirmasi,
// file tagihan baru setelah tagihannya terbit.
router.get("/files/:id", auth, async (req, res) => {
  const file = await one(pool, "select * from files where id = $1", [param(req, "id")]) ?? fail(404, "File tidak ditemukan", "NOT_FOUND")
  if (req.user!.role !== "admin") {
    if (!file.project_id) fail(404, "File tidak ditemukan", "NOT_FOUND")
    await projectFor(pool, req, file.project_id)
    if (file.purpose === "invoice_pembelian" && !(await one(pool, "select 1 from purchases where file_id = $1 and status = 'terkonfirmasi'", [file.id])))
      fail(404, "File tidak ditemukan", "NOT_FOUND")
    if (file.purpose === "tagihan_pdf" && !(await one(pool, "select 1 from invoices where pdf_file_id = $1 and status in ('terbit', 'lunas')", [file.id])))
      fail(404, "File tidak ditemukan", "NOT_FOUND")
  }
  const buf = await getFile(file.storage_key)
  res.setHeader("Content-Type", file.mime_type)
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.original_name)}`)
  res.setHeader("Cache-Control", "private, no-store")
  res.send(buf)
})
