import { useState, type FormEvent } from "react"
import { Link, useLocation } from "react-router"
import { login } from "../../core/session"
import { Field } from "../../core/ui"

// Masuk dengan email dan password (PRD bagian 4). Setelah berhasil, penjaga rute membawa user ke halaman tujuan.
export default function LoginPage() {
  const location = useLocation()
  const [error, setError] = useState(""), [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true); setError("")
    try { await login(String(f.get("email")), String(f.get("password"))) } catch (err) { setError((err as Error).message); setBusy(false) }
  }

  return (
    <section className="wrap page narrow">
      <form className="card form auth" onSubmit={submit}>
        <h1>Masuk</h1>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        {error && <p className="msg bad" role="alert">{error}</p>}
        <button className="btn pri" disabled={busy}>{busy ? "Memproses..." : "Masuk"}</button>
        <p className="sub">Belum punya akun? <Link to="/daftar" state={location.state}>Daftar di sini</Link></p>
      </form>
    </section>
  )
}
