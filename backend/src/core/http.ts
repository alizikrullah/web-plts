import type { NextFunction, Request, Response } from "express"
import { verifyToken, type Claims } from "./tokens.js"

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message) }
}
export const fail = (status: number, message: string, code?: string): never => { throw new HttpError(status, message, code) }

export type Role = "guest" | "client" | "admin"
declare global {
  namespace Express { interface Request { user?: Claims } }
}

// Pengecekan izin selalu di backend (PRD bagian 4). Role diambil dari access token.
const ALLOWED_WHILE_MUST_CHANGE = ["/api/me", "/api/me/password", "/api/auth/logout"]
export function auth(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
  const claims = token ? verifyToken(token) : null
  if (!claims) return fail(401, "Silakan masuk dulu", "UNAUTHENTICATED")
  if (claims.mcp && !ALLOWED_WHILE_MUST_CHANGE.includes(req.path === "/" ? req.baseUrl : req.baseUrl + req.path))
    return fail(403, "Ganti password sementara dulu", "MUST_CHANGE_PASSWORD")
  req.user = claims
  next()
}
// Untuk endpoint publik yang tampil berbeda kalau user sudah masuk.
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
  const claims = token ? verifyToken(token) : null
  if (claims && !claims.mcp) req.user = claims
  next()
}
export const allow = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) return fail(403, "Tidak punya akses ke halaman ini", "FORBIDDEN")
  next()
}

export function cors(req: Request, res: Response, next: NextFunction) {
  const origins = (process.env.FRONTEND_ORIGIN ?? "").split(",").map(s => s.trim()).filter(Boolean)
  const origin = req.headers.origin
  if (origin && origins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Access-Control-Allow-Credentials", "true")
    res.setHeader("Vary", "Origin")
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE")
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Filename")
      return void res.status(204).end()
    }
  }
  next()
}

export function errors(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, code: err.code })
  if (err?.type === "entity.too.large") return void res.status(413).json({ error: "File maksimal 10 MB" })
  if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "Isi kiriman tidak valid" })
  if (err?.code === "P0001") return void res.status(400).json({ error: err.message, code: "FORBIDDEN_DELETE" })
  if (err?.code === "23505") return void res.status(409).json({ error: "Data yang sama sudah ada", code: err.constraint })
  if (err?.code === "23514" || err?.code === "23503") return void res.status(400).json({ error: "Data tidak sesuai aturan", code: err.constraint })
  console.error(err)
  res.status(500).json({ error: "Terjadi kesalahan di server" })
}

export const cookie = (req: Request, name: string) =>
  req.headers.cookie?.split(/;\s*/).find(c => c.startsWith(name + "="))?.slice(name.length + 1)

// Pemeriksa isian. Semua isian dari browser dianggap tidak bisa dipercaya.
type Body = Record<string, unknown>
const bad = (field: string, why: string) => fail(400, `${field} ${why}`, "INVALID_INPUT")
export const v = {
  str(b: Body, k: string, max = 255): string {
    const x = b[k]
    if (typeof x !== "string" || !x.trim()) return bad(k, "wajib diisi")
    if (x.trim().length > max) return bad(k, `maksimal ${max} karakter`)
    return x.trim()
  },
  optStr(b: Body, k: string, max = 255): string | null {
    return b[k] === undefined || b[k] === null || b[k] === "" ? null : v.str(b, k, max)
  },
  text(b: Body, k: string) { return v.str(b, k, 20000) },
  optText(b: Body, k: string) { return v.optStr(b, k, 20000) },
  num(b: Body, k: string, min = -Infinity): number {
    const x = b[k]
    if (typeof x !== "number" || !Number.isFinite(x)) return bad(k, "harus angka")
    if (x < min) return bad(k, `minimal ${min}`)
    return x
  },
  optNum(b: Body, k: string, min = -Infinity): number | null { return b[k] === undefined || b[k] === null ? null : v.num(b, k, min) },
  int(b: Body, k: string, min = -Infinity): number {
    const x = v.num(b, k, min)
    return Number.isInteger(x) ? x : bad(k, "harus bilangan bulat")
  },
  optInt(b: Body, k: string, min = -Infinity): number | null { return b[k] === undefined || b[k] === null ? null : v.int(b, k, min) },
  money(b: Body, k: string, min = 0) { return v.int(b, k, min) },
  bool(b: Body, k: string): boolean {
    return typeof b[k] === "boolean" ? (b[k] as boolean) : bad(k, "harus benar atau salah")
  },
  oneOf<T extends string>(b: Body, k: string, options: readonly T[]): T {
    return options.includes(b[k] as T) ? (b[k] as T) : bad(k, `harus salah satu dari: ${options.join(", ")}`)
  },
  date(b: Body, k: string): string {
    const x = b[k]
    if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x) || isNaN(Date.parse(x))) return bad(k, "harus tanggal YYYY-MM-DD")
    return x
  },
  optDate(b: Body, k: string): string | null { return b[k] === undefined || b[k] === null || b[k] === "" ? null : v.date(b, k) },
  uuid(b: Body, k: string): string {
    return typeof b[k] === "string" && isUuid(b[k] as string) ? (b[k] as string) : bad(k, "tidak valid")
  },
  optUuid(b: Body, k: string): string | null { return b[k] === undefined || b[k] === null ? null : v.uuid(b, k) },
  email(b: Body, k = "email"): string {
    const x = v.str(b, k).toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) ? x : bad(k, "tidak valid")
  },
  // Nomor WhatsApp disimpan sebagai angka dengan kode negara (PRD bagian 17): 0812... menjadi 62812...
  whatsapp(b: Body, k = "whatsapp"): string {
    let x = v.str(b, k).replace(/\D/g, "")
    if (x.startsWith("0")) x = "62" + x.slice(1)
    return /^[1-9]\d{7,14}$/.test(x) ? x : bad(k, "tidak valid")
  },
  array(b: Body, k: string): Body[] {
    const x = b[k]
    return Array.isArray(x) && x.every(i => i && typeof i === "object") ? (x as Body[]) : bad(k, "harus daftar")
  },
}
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
export const param = (req: Request, k: string) => {
  const x = String(req.params[k])
  return isUuid(x) ? x : fail(404, "Data tidak ditemukan", "NOT_FOUND")
}
