import { useState, type FormEvent } from "react"
import { Link, useLocation } from "react-router"
import { ApiError } from "../../core/api"
import { login } from "../../core/session"
import { Field } from "../../core/ui"
import { ResendVerification } from "./EmailPages"

// Masuk dengan email dan password (PRD bagian 4). Setelah berhasil, penjaga rute membawa user ke halaman tujuan.
// Akun yang emailnya belum diverifikasi ditolak, dengan tombol kirim ulang link verifikasi.
export default function LoginPage() {
  const location = useLocation()
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [unverified, setUnverified] = useState("")

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget), email = String(f.get("email"))
    setBusy(true); setError(""); setUnverified("")
    try { await login(email, String(f.get("password"))) } catch (err) {
      setError((err as Error).message); setBusy(false)
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") setUnverified(email)
    }
  }

  return (
    <section className="wrap page narrow">
      <form className="card form auth" onSubmit={submit}>
        <h1>Masuk</h1>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <p className="hint"><Link to="/lupa-password">Lupa password?</Link></p>
        {error && <p className="msg bad" role="alert">{error}</p>}
        {unverified && <ResendVerification email={unverified} />}
        <button className="btn pri" disabled={busy}>{busy ? "Memproses..." : "Masuk"}</button>
        <p className="sub">Belum punya akun? <Link to="/daftar" state={location.state}>Daftar di sini</Link></p>
      </form>
    </section>
  )
}
