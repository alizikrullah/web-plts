import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router"
import { api } from "../../core/api"
import { logout } from "../../core/session"
import { Field, Loading, Message, useAction } from "../../core/ui"

// Halaman dari link di email: verifikasi akun dan reset password (PRD bagian 4).

// Kirim ulang link verifikasi. Backend membatasi sekali per menit, jadi tombolnya juga istirahat satu menit.
export function ResendVerification({ email }: { email: string }) {
  const act = useAction(), [wait, setWait] = useState(false)
  const send = () => act.run(async () => {
    await api("/api/auth/resend-verification", { body: { email } })
    setWait(true); setTimeout(() => setWait(false), 60_000)
  }, `Kalau ${email} belum terverifikasi, link baru sudah dikirim. Cek email Anda.`)
  return (
    <>
      <Message msg={act.msg} />
      <button type="button" className="btn" disabled={act.busy || wait} onClick={send}>Kirim ulang link verifikasi</button>
    </>
  )
}

export function VerifyEmailPage() {
  const token = useSearchParams()[0].get("token") ?? ""
  const [state, setState] = useState<"loading" | "ok" | "bad">("loading"), [error, setError] = useState(""), [email, setEmail] = useState("")
  const once = useRef(false)
  useEffect(() => {
    if (once.current) return
    once.current = true
    api("/api/auth/verify-email", { body: { token } }).then(() => setState("ok"), e => { setError(e.message); setState("bad") })
  }, [token])
  if (state === "loading") return <Loading />
  return (
    <section className="wrap page narrow">
      {state === "ok" ? (
        <div className="card form auth">
          <h1>Email terverifikasi</h1>
          <p>Akun Anda sudah aktif. Silakan masuk.</p>
          <Link className="btn pri" to="/masuk">Masuk</Link>
        </div>
      ) : (
        <div className="card form auth">
          <h1>Link tidak berlaku</h1>
          <p className="msg bad" role="alert">{error}</p>
          <Field label="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
          {/\S+@\S+\.\S+/.test(email) && <ResendVerification email={email} />}
          <p className="sub">Sudah terverifikasi? <Link to="/masuk">Masuk di sini</Link></p>
        </div>
      )}
    </section>
  )
}

export function ForgotPasswordPage() {
  const act = useAction(), [sent, setSent] = useState(false)
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const email = String(new FormData(e.currentTarget).get("email"))
    act.run(async () => { await api("/api/auth/forgot-password", { body: { email } }); setSent(true) })
  }
  return (
    <section className="wrap page narrow">
      <form className="card form auth" onSubmit={submit}>
        <h1>Lupa password</h1>
        {sent ? (
          <>
            <p className="msg ok" role="status">Kalau email itu terdaftar, link untuk membuat password baru sudah dikirim. Link berlaku 1 jam. Cek juga folder spam.</p>
            <Link className="btn" to="/masuk">Kembali ke Masuk</Link>
          </>
        ) : (
          <>
            <p className="sub">Masukkan email akun Anda. Kami kirim link untuk membuat password baru.</p>
            <Field label="Email" name="email" type="email" autoComplete="email" required />
            <Message msg={act.msg} />
            <button className="btn pri" disabled={act.busy}>{act.busy ? "Mengirim..." : "Kirim link reset"}</button>
            <p className="sub"><Link to="/masuk">Kembali ke Masuk</Link></p>
          </>
        )}
      </form>
    </section>
  )
}

export function ResetPasswordPage() {
  const token = useSearchParams()[0].get("token") ?? ""
  const act = useAction(), [done, setDone] = useState(false)
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget), next = String(f.get("new_password"))
    if (next !== f.get("repeat")) return act.setMsg({ ok: false, text: "Ulangi password baru belum sama." })
    // Semua sesi lama dicabut di backend, jadi sesi di browser ini juga dilepas.
    act.run(async () => { await api("/api/auth/reset-password", { body: { token, new_password: next } }); await logout(); setDone(true) })
  }
  return (
    <section className="wrap page narrow">
      <form className="card form auth" onSubmit={submit}>
        <h1>Buat password baru</h1>
        {done ? (
          <>
            <p className="msg ok" role="status">Password sudah diganti. Silakan masuk dengan password baru.</p>
            <Link className="btn pri" to="/masuk">Masuk</Link>
          </>
        ) : (
          <>
            <Field label="Password baru" name="new_password" type="password" autoComplete="new-password" minLength={8} required hint="Minimal 8 karakter." />
            <Field label="Ulangi password baru" name="repeat" type="password" autoComplete="new-password" minLength={8} required />
            <Message msg={act.msg} />
            <button className="btn pri" disabled={act.busy}>{act.busy ? "Menyimpan..." : "Simpan password baru"}</button>
            {act.msg && !act.msg.ok && <p className="sub"><Link to="/lupa-password">Minta link baru</Link></p>}
          </>
        )}
      </form>
    </section>
  )
}
