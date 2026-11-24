import { useState, type FormEvent } from "react"
import { Link, useLocation } from "react-router"
import { register, rememberAfterLogin } from "../../core/session"
import { Field } from "../../core/ui"
import { ResendVerification } from "./EmailPages"

// Daftar: nama, email, nomor WhatsApp, dan password. Hasilnya selalu akun guest; role tidak pernah dikirim dari form (PRD bagian 2).
// Akun baru aktif setelah link verifikasi di email diklik (PRD bagian 4).
export default function RegisterPage() {
  const location = useLocation()
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [sentTo, setSentTo] = useState("")

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    setBusy(true); setError("")
    try {
      const r = await register({ name: f.name, email: f.email, whatsapp: f.whatsapp, password: f.password })
      rememberAfterLogin((location.state as { from?: string } | null)?.from)
      setSentTo(r.email)
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  if (sentTo) return (
    <section className="wrap page narrow">
      <div className="card form auth">
        <h1>Cek email Anda</h1>
        <p>Link verifikasi sudah dikirim ke <b>{sentTo}</b>. Klik link itu untuk mengaktifkan akun, lalu masuk. Link berlaku 24 jam.</p>
        <p className="sub">Tidak ada email masuk? Cek folder spam atau promosi, atau kirim ulang.</p>
        <ResendVerification email={sentTo} />
        <Link className="btn" to="/masuk">Ke halaman Masuk</Link>
      </div>
    </section>
  )

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
