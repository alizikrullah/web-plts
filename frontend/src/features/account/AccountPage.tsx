import { useState, type FormEvent } from "react"
import { LuLogOut } from "react-icons/lu"
import { useNavigate } from "react-router"
import { api, setAuth, updateUser, type Auth, type User } from "../../core/api"
import { logout, useSession } from "../../core/session"
import { Field } from "../../core/ui"

const ROLE = { guest: "Guest", client: "Client", admin: "Admin" }
// Nomor disimpan dengan kode negara (62812...), ditampilkan seperti yang biasa diketik (0812...).
const localWa = (wa: string) => (wa.startsWith("62") ? "0" + wa.slice(2) : wa)
type Msg = { ok: boolean; text: string } | null
const Message = ({ msg }: { msg: Msg }) => msg && <p className={msg.ok ? "msg ok" : "msg bad"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>

// Halaman Akun untuk semua role yang sudah masuk: ubah nama dan WhatsApp, ganti password, dan keluar (PRD bagian 4).
export default function AccountPage() {
  const session = useSession(), navigate = useNavigate()
  const [profileMsg, setProfileMsg] = useState<Msg>(null), [passwordMsg, setPasswordMsg] = useState<Msg>(null)
  if (session.status !== "user") return null
  const user = session.user

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    try {
      updateUser((await api<{ user: User }>("/api/me", { method: "PATCH", body: { name: f.get("name"), whatsapp: f.get("whatsapp") } })).user)
      setProfileMsg({ ok: true, text: "Data akun tersimpan." })
    } catch (err) { setProfileMsg({ ok: false, text: (err as Error).message }) }
  }

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget, f = new FormData(form)
    if (f.get("new_password") !== f.get("repeat")) return setPasswordMsg({ ok: false, text: "Ulangi password baru belum sama." })
    try {
      setAuth(await api<Auth>("/api/me/password", { body: { current_password: f.get("current_password"), new_password: f.get("new_password") } }))
      form.reset()
      setPasswordMsg({ ok: true, text: "Password sudah diganti." })
    } catch (err) { setPasswordMsg({ ok: false, text: (err as Error).message }) }
  }

  async function signOut() {
    navigate("/", { replace: true })
    await logout()
  }

  return (
    <section className="wrap page narrow">
      <h1>Akun</h1>
      {user.must_change_password && (
        <p className="msg warn" role="alert">Anda masuk dengan password sementara. Ganti password dulu sebelum memakai fitur lain.</p>
      )}

      <form className="card form" onSubmit={saveProfile}>
        <h2>Data akun</h2>
        <dl className="info">
          <dt>Email</dt><dd>{user.email}</dd>
          <dt>Role</dt><dd>{ROLE[user.role]}</dd>
        </dl>
        <Field label="Nama" name="name" defaultValue={user.name} autoComplete="name" required />
        <Field label="Nomor WhatsApp" name="whatsapp" type="tel" inputMode="tel" defaultValue={localWa(user.whatsapp)} autoComplete="tel" required />
        <Message msg={profileMsg} />
        <button className="btn pri">Simpan data</button>
      </form>

      <form className="card form" onSubmit={changePassword}>
        <h2>Ganti password</h2>
        <Field label="Password lama" name="current_password" type="password" autoComplete="current-password" required />
        <Field label="Password baru" name="new_password" type="password" autoComplete="new-password" minLength={8} required hint="Minimal 8 karakter." />
        <Field label="Ulangi password baru" name="repeat" type="password" autoComplete="new-password" minLength={8} required />
        <Message msg={passwordMsg} />
        <button className="btn pri">Ganti password</button>
      </form>

      <button type="button" className="btn danger" onClick={signOut}><LuLogOut aria-hidden />Keluar</button>
    </section>
  )
}
