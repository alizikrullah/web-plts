// Semua panggilan ke backend lewat sini (PRD bagian 4). Access token hanya disimpan di memori, bukan localStorage;
// refresh token ada di cookie httpOnly yang diatur backend. Saat pengembangan, /api diteruskan Vite ke backend.
// Saat dipasang, VITE_API_URL berisi alamat backend (misalnya https://api.domain.com) yang satu domain induk dengan frontend.
const BASE = import.meta.env.VITE_API_URL ?? ""

export type Role = "guest" | "client" | "admin"
export interface User { id: string; name: string; email: string; whatsapp: string; role: Role; must_change_password: boolean }
export interface Auth { access_token: string; user: User }

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message) }
}

let token: string | null = null
let listener: (a: Auth | null) => void = () => {}
export const onAuthChange = (fn: (a: Auth | null) => void) => { listener = fn }
export function setAuth(a: Auth | null) { token = a?.access_token ?? null; listener(a) }
export const updateUser = (user: User) => { if (token) listener({ access_token: token, user }) }

// Waktu habis access token dibaca dari isi token. Hanya untuk menjadwalkan pembaruan; pengaman sebenarnya di backend.
export function tokenExpiresAt() {
  if (!token) return 0
  return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp * 1000
}

async function send(path: string, method: string, body?: unknown) {
  try {
    return await fetch(BASE + path, { method, credentials: "include", body: body === undefined ? undefined : JSON.stringify(body),
      headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(token && { authorization: `Bearer ${token}` }) } })
  } catch {
    throw new ApiError(0, "Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.")
  }
}

// Refresh token hanya bisa dipakai sekali lalu diganti, jadi permintaan refresh yang bersamaan disatukan.
let refreshing: Promise<Auth | null> | null = null
export function refreshSession() {
  refreshing ??= send("/api/auth/refresh", "POST")
    .then(r => (r.ok ? (r.json() as Promise<Auth>) : null), () => null)
    .then(a => { setAuth(a); return a })
    .finally(() => { refreshing = null })
  return refreshing
}

// File dibuka lewat backend setelah cek pemilik (PRD bagian 4), jadi diambil dengan token lalu ditampilkan dari memori browser.
export async function fileBlob(path: string) {
  let res = await send(path, "GET")
  if (res.status === 401 && token && (await refreshSession())) res = await send(path, "GET")
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? "File tidak bisa dibuka")
  return res.blob()
}
// Tab baru dibuka lebih dulu supaya tidak diblokir browser, baru diisi setelah file selesai diambil.
// Kesalahan dilempar, supaya pesannya bisa ditampilkan di dekat tombol (misalnya pratinjau tagihan).
export async function showFile(path: string) {
  const w = window.open("", "_blank")
  try {
    const url = URL.createObjectURL(await fileBlob(path))
    if (w) w.location.href = url
    else location.assign(url)
  } catch (e) { w?.close(); throw e }
}
export const openFile = (path: string) => showFile(path).catch(e => alert((e as Error).message))
export async function uploadFile(projectId: string, purpose: string, file: File) {
  const res = await fetch(`${BASE}/api/admin/projects/${projectId}/files?purpose=${purpose}`, { method: "POST", credentials: "include", body: file,
    headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name), ...(token && { authorization: `Bearer ${token}` }) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? "File gagal diunggah", data.code)
  return data.file as { id: string; original_name: string }
}

// Pesan isian dari backend memakai nama kolom; di layar diganti nama isiannya.
const LABELS: Record<string, string> = { name: "Nama", email: "Email", whatsapp: "Nomor WhatsApp", password: "Password",
  new_password: "Password baru", current_password: "Password lama" }

export async function api<T = unknown>(path: string, opt: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opt.method ?? (opt.body === undefined ? "GET" : "POST")
  let res = await send(path, method, opt.body)
  // Access token habis setelah 15 menit: minta yang baru lewat cookie, lalu ulangi sekali.
  if (res.status === 401 && token && (await refreshSession())) res = await send(path, method, opt.body)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? "Terjadi kesalahan. Coba lagi.").replace(/^\w+/, k => LABELS[k] ?? k), data.code)
  return data as T
}
