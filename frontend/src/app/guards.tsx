import { useEffect, type ReactNode } from "react"
import { Navigate, useLocation } from "react-router"
import type { Role } from "../core/api"
import { afterLogin, forgetAfterLogin, useSession } from "../core/session"
import { Loading } from "../core/ui"

// Penjaga rute hanya memilih tampilan; pengaman yang sebenarnya ada di backend (PRD bagian 4).
// Pengunjung diminta masuk dulu. Role yang tidak berhak diarahkan ke Home (skenario 2).
export function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const session = useSession(), { pathname } = useLocation()
  if (session.status === "loading") return <Loading />
  if (session.status === "anon") return <Navigate to="/masuk" replace state={{ from: pathname, notice: "Silakan masuk dulu untuk membuka halaman itu." }} />
  if (roles && !roles.includes(session.user.role)) return <Navigate to="/" replace state={{ notice: "Halaman itu tidak bisa dibuka dengan akun Anda." }} />
  return children
}

// Halaman Masuk, Daftar, dan Lupa password. Setelah berhasil masuk, user dibawa ke halaman yang tadi ingin dibuka,
// termasuk tujuan yang disimpan saat daftar sebelum verifikasi email.
export function AnonOnly({ children }: { children: ReactNode }) {
  const session = useSession(), from = (useLocation().state as { from?: string } | null)?.from
  useEffect(() => { if (session.status === "user") forgetAfterLogin() }, [session.status])
  if (session.status === "loading") return <Loading />
  return session.status === "user" ? <Navigate to={from ?? afterLogin() ?? "/"} replace /> : children
}
