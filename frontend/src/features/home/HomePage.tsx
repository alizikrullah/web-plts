import { useEffect } from "react"
import { api, refreshSession, updateUser, type User } from "../../core/api"
import { useSession } from "../../core/session"
import { Loading } from "../../core/ui"
import AdminHome from "./AdminHome"
import ClientHome from "./ClientHome"
import VisitorHome from "./VisitorHome"

// Pemilih Home (PRD bagian 5): memuat, pengunjung atau guest, client, admin.
export default function HomePage() {
  const session = useSession()
  // Saat Home dibuka, role terbaru dicek ke database. Kalau berbeda dari token, misalnya guest yang baru diterima admin,
  // frontend meminta token baru, jadi tampilan client muncul tanpa login ulang (skenario 4).
  useEffect(() => {
    if (session.status !== "user") return
    const role = session.user.role
    api<{ user: User }>("/api/me").then(({ user }) => { if (user.role !== role) refreshSession(); else updateUser(user) }).catch(() => {})
  }, [session.status])

  if (session.status === "loading") return <Loading />
  if (session.status === "anon" || session.user.role === "guest") return <VisitorHome />
  return session.user.role === "client" ? <ClientHome user={session.user} /> : <AdminHome user={session.user} />
}
