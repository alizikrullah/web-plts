import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { api, onAuthChange, refreshSession, setAuth, tokenExpiresAt, type Auth, type User } from "./api"

// Status sesi: "loading" selama sesi dari cookie belum selesai dicek, supaya tampilan tidak berkedip (PRD bagian 4).
export type Session = { status: "loading" } | { status: "anon" } | { status: "user"; user: User }
const Ctx = createContext<Session>({ status: "loading" })
export const useSession = () => useContext(Ctx)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, set] = useState<Session>({ status: "loading" })
  useEffect(() => {
    onAuthChange(a => set(a ? { status: "user", user: a.user } : { status: "anon" }))
    refreshSession() // memulihkan sesi dari cookie saat aplikasi dibuka
  }, [])
  // Token diperbarui semenit sebelum habis. Akun yang dinonaktifkan gagal diperbarui, jadi keluar paling lama 15 menit kemudian.
  useEffect(() => {
    if (session.status !== "user") return
    const t = setTimeout(refreshSession, Math.max(tokenExpiresAt() - Date.now() - 60_000, 5_000))
    return () => clearTimeout(t)
  }, [session])
  return <Ctx.Provider value={session}>{children}</Ctx.Provider>
}

export const login = (email: string, password: string) => api<Auth>("/api/auth/login", { body: { email, password } }).then(setAuth)
// Daftar tidak langsung masuk: akun aktif setelah link verifikasi di email diklik (PRD bagian 4).
export const register = (body: { name: string; email: string; whatsapp: string; password: string }) =>
  api<{ email: string; needs_verification: true }>("/api/auth/register", { body })

// Halaman tujuan setelah masuk (misalnya kembali ke Simulator) disimpan di browser, karena link verifikasi
// biasanya dibuka dari aplikasi email, jadi tujuan di riwayat halaman ikut hilang.
const AFTER = "plts-setelah-masuk"
export const rememberAfterLogin = (path: string | undefined) => { try { if (path) localStorage.setItem(AFTER, path) } catch { /* diblokir */ } }
export const afterLogin = () => { try { return localStorage.getItem(AFTER) } catch { return null } }
export const forgetAfterLogin = () => { try { localStorage.removeItem(AFTER) } catch { /* diblokir */ } }
// Keluar mencabut refresh token di backend.
export async function logout() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {})
  setAuth(null)
}
