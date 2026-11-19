import { useEffect, useState } from "react"
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router"
import { LuMenu, LuSun } from "react-icons/lu"
import { useSession, type Session } from "../core/session"

const HOME = { to: "/", label: "Home" }, SIMULATOR = { to: "/simulator", label: "Simulator" }, AKUN = { to: "/akun", label: "Akun" }

// Navbar per role (PRD bagian 2). Selama sesi dicek, hanya menu yang sama untuk semua yang tampil.
function menuFor(s: Session) {
  if (s.status === "loading") return [HOME, SIMULATOR]
  if (s.status === "anon") return [HOME, SIMULATOR, { to: "/masuk", label: "Masuk" }, { to: "/daftar", label: "Daftar" }]
  if (s.user.must_change_password) return [AKUN]
  if (s.user.role === "guest") return [HOME, SIMULATOR, AKUN]
  if (s.user.role === "client")
    return [HOME, SIMULATOR, { to: "/status-pengerjaan", label: "Status Pengerjaan" }, { to: "/invoice-pembelian", label: "Invoice Pembelian" }, AKUN]
  return [HOME, SIMULATOR, { to: "/client", label: "Client" }, { to: "/list-part", label: "List Part" }, { to: "/pengaturan", label: "Pengaturan" }, AKUN]
}

export default function Layout() {
  const session = useSession(), location = useLocation()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [location.pathname])
  const notice = (location.state as { notice?: string } | null)?.notice
  // Password sementara wajib diganti dulu sebelum halaman lain bisa dibuka (PRD bagian 4).
  const mustChange = session.status === "user" && session.user.must_change_password && location.pathname !== "/akun"

  return (
    <div className="app">
      <header className="site">
        <div className="wrap site-bar">
          <Link to="/" className="brand"><LuSun aria-hidden /><span>PLTS Rumah</span></Link>
          <button type="button" className="menu-btn" aria-expanded={open} aria-controls="menu-utama" onClick={() => setOpen(o => !o)}>
            <LuMenu aria-hidden /><span>Menu</span>
          </button>
          <nav id="menu-utama" aria-label="Menu utama" className={open ? "nav open" : "nav"}>
            {menuFor(session).map(i => <NavLink key={i.to} to={i.to} end={i.to === "/"}>{i.label}</NavLink>)}
          </nav>
        </div>
      </header>
      {notice && <p className="wrap notice" role="status">{notice}</p>}
      <main>{mustChange ? <Navigate to="/akun" replace /> : <Outlet />}</main>
      <footer className="site-footer"><div className="wrap">PLTS Rumah</div></footer>
    </div>
  )
}
