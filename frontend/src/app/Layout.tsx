import { useEffect, useState } from "react"
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router"
import { LuCircleUserRound, LuLogIn, LuMenu, LuSun, LuUserPlus } from "react-icons/lu"
import { useSession, type Session } from "../core/session"

const HOME = { to: "/", label: "Home" }, SIMULATOR = { to: "/simulator", label: "Simulator" }

// Navbar per role (PRD bagian 2). Selama sesi dicek, hanya menu yang sama untuk semua yang tampil.
function menuFor(s: Session) {
  if (s.status === "loading") return [HOME, SIMULATOR]
  if (s.status === "anon" || s.user.role === "guest") return [HOME, SIMULATOR]
  if (s.user.must_change_password) return []
  if (s.user.role === "client") return [HOME, SIMULATOR, { to: "/status-pengerjaan", label: "Status Pengerjaan" }, { to: "/invoice-pembelian", label: "Invoice Pembelian" }]
  return [HOME, SIMULATOR, { to: "/client", label: "Client" }, { to: "/list-part", label: "List Part" }, { to: "/pengaturan", label: "Pengaturan" }]
}
// Masuk, Daftar, dan Akun dibuat beda dari menu (tombol dan ikon) dan selalu terlihat, juga di HP.
function accountFor(s: Session) {
  if (s.status === "loading") return []
  if (s.status === "anon") return [{ to: "/masuk", label: "Masuk", icon: LuLogIn, cls: "btn sm" }, { to: "/daftar", label: "Daftar", icon: LuUserPlus, cls: "btn sm pri" }]
  return [{ to: "/akun", label: "Akun", icon: LuCircleUserRound, cls: "acct" }]
}

export default function Layout() {
  const session = useSession(), location = useLocation()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [location.pathname])
  const notice = (location.state as { notice?: string } | null)?.notice
  // Password sementara wajib diganti dulu sebelum halaman lain bisa dibuka (PRD bagian 4).
  const mustChange = session.status === "user" && session.user.must_change_password && location.pathname !== "/akun"
  const menu = menuFor(session), account = accountFor(session)

  return (
    <div className="app">
      <header className="site">
        <div className="wrap site-bar">
          <Link to="/" className="brand"><LuSun aria-hidden /><span>PLTS Rumah</span></Link>
          {menu.length > 0 && <nav id="menu-utama" aria-label="Menu utama" className={open ? "nav open" : "nav"}>
            {menu.map(i => <NavLink key={i.to} to={i.to} end={i.to === "/"}>{i.label}</NavLink>)}
          </nav>}
          {account.length > 0 && <nav aria-label="Akun" className="acct-nav">
            {account.map(i => <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? `${i.cls} active` : i.cls)}><i.icon aria-hidden /><span>{i.label}</span></NavLink>)}
          </nav>}
          {menu.length > 0 && <button type="button" className="menu-btn" aria-label="Menu" aria-expanded={open} aria-controls="menu-utama" onClick={() => setOpen(o => !o)}>
            <LuMenu aria-hidden /><span>Menu</span>
          </button>}
        </div>
      </header>
      {notice && <p className="wrap notice" role="status">{notice}</p>}
      <main>{mustChange ? <Navigate to="/akun" replace /> : <Outlet />}</main>
      <footer className="site-footer"><div className="wrap">PLTS Rumah</div></footer>
    </div>
  )
}
