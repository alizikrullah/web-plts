import { useState, type FormEvent } from "react"
import { Link, useLocation } from "react-router"
import { register } from "../../core/session"
import { Field } from "../../core/ui"

// Daftar: nama, email, nomor WhatsApp, dan password. Hasilnya selalu akun guest; role tidak pernah dikirim dari form (PRD bagian 2).
export default function RegisterPage() {
  const location = useLocation()
  const [error, setError] = useState(""), [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    setBusy(true); setError("")
    try { await register({ name: f.name, email: f.email, whatsapp: f.whatsapp, password: f.password }) } catch (err) { setError((err as Error).message); setBusy(false) }
  }

  return (
    <section className="wrap page narrow">
      <form className="card form auth" onSubmit={submit}>
        <h1>Daftar</h1>
        <Field label="Nama" name="name" autoComplete="name" required />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Nomor WhatsApp" name="whatsapp" type="tel" inputMode="tel" autoComplete="tel" placeholder="0812 3456 7890" required />
        <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={8} required hint="Minimal 8 karakter." />
        {error && <p className="msg bad" role="alert">{error}</p>}
        <button className="btn pri" disabled={busy}>{busy ? "Memproses..." : "Daftar"}</button>
        <p className="sub">Sudah punya akun? <Link to="/masuk" state={location.state}>Masuk di sini</Link></p>
      </form>
    </section>
  )
}
