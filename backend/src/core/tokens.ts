import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import type { Role } from "./http.js"

// JWT HS256 dengan crypto bawaan Node. Access token berumur 15 menit (PRD bagian 4).
export const ACCESS_TTL_SEC = 15 * 60
export const REFRESH_TTL_SEC = 7 * 24 * 60 * 60
export interface Claims { sub: string; role: Role; mcp?: boolean; exp: number }

const secret = () => process.env.JWT_SECRET || (() => { throw new Error("JWT_SECRET belum diisi") })()
const HEADER = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")
const sign = (data: string) => createHmac("sha256", secret()).update(data).digest()

export function signAccess(user: { id: string; role: Role; must_change_password: boolean }) {
  const claims: Claims = { sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SEC }
  if (user.must_change_password) claims.mcp = true
  const data = HEADER + "." + Buffer.from(JSON.stringify(claims)).toString("base64url")
  return data + "." + sign(data).toString("base64url")
}

export function verifyToken(token: string): Claims | null {
  const [h, p, s] = token.split(".")
  if (h !== HEADER || !p || !s) return null
  const got = Buffer.from(s, "base64url"), want = sign(h + "." + p)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as Claims
    return claims.exp > Date.now() / 1000 ? claims : null
  } catch {
    return null
  }
}

// Refresh token acak; yang disimpan di database hanya hash-nya.
export const newRefreshToken = () => randomBytes(32).toString("base64url")
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex")

// Password di-hash dengan scrypt dan garam acak (PRD bagian 12).
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>
export async function hashPassword(pw: string) {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString("base64")}$${(await scryptAsync(pw, salt, 64)).toString("base64")}`
}
export async function checkPassword(pw: string, stored: string) {
  const [kind, salt, hash] = stored.split("$")
  if (kind !== "scrypt") return false
  const want = Buffer.from(hash, "base64"), got = await scryptAsync(pw, Buffer.from(salt, "base64"), want.length)
  return timingSafeEqual(got, want)
}
// Password sementara buatan admin: 12 karakter acak tanpa huruf yang mirip.
export function tempPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  return [...randomBytes(12)].map(b => chars[b % chars.length]).join("")
}
