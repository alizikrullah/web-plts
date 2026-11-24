import { useState, type FormEvent } from "react"
import { Link } from "react-router"
import { api } from "../../core/api"
import { useSession } from "../../core/session"
import { Field, Loading, Message, useAction } from "../../core/ui"
import { useApi } from "../../core/useApi"

interface User { id: string; name: string; email: string; whatsapp: string; role: string; is_active: boolean; is_verified: boolean; must_change_password: boolean }
const ROLE: Record<string, string> = { guest: "Guest", client: "Client", admin: "Admin" }

// Kelola Akun di dalam Pengaturan (PRD bagian 4): cari, nonaktifkan atau aktifkan lagi, buat akun admin, dan password sementara.
export default function ManageAccounts() {
  const session = useSession()
  const [q, setQ] = useState(""), [search, setSearch] = useState("")
  const d = useApi<{ users: User[] }>(`/api/admin/users?q=${encodeURIComponent(search)}`)
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null)
  const act = useAction(), add = useAction()
  const me = session.status === "user" ? session.user.id : ""
  const toggle = (u: User) => act.run(async () => { await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { is_active: !u.is_active } }); d.reload() },
    u.is_active ? `Akun ${u.email} dinonaktifkan. Aksesnya berhenti paling lama 15 menit lagi.` : `Akun ${u.email} aktif lagi.`)
  const temp = (u: User) => act.run(async () => {
    const r = await api<{ temporary_password: string }>(`/api/admin/users/${u.id}/temp-password`, { body: {} })
    setShown({ email: u.email, password: r.temporary_password }); d.reload()
  })
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget, f = new FormData(form)
    add.run(async () => {
      const r = await api<{ user: User; temporary_password: string }>("/api/admin/users", { body: { name: f.get("name"), email: f.get("email"), whatsapp: f.get("whatsapp") } })
      setShown({ email: r.user.email, password: r.temporary_password }); form.reset(); d.reload()
    })
  }

  return (
    <>
      {shown && <p className="msg warn" role="status">Password sementara untuk {shown.email}: <b>{shown.password}</b>. Kirim lewat WhatsApp. Wajib diganti saat masuk berikutnya.</p>}
      <div className="card">
        <form className="filters" onSubmit={e => { e.preventDefault(); setSearch(q.trim()) }}>
          <label>Cari akun <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Nama, email, atau nomor" /></label>
          <button className="btn">Cari</button>
        </form>
        <Message msg={act.msg} />
        {!d.data ? <Loading /> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Nama</th><th>Email</th><th>WhatsApp</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>{d.data.users.map(u => (
              <tr key={u.id} className={u.is_active ? "" : "off"}>
                <td>{u.name}{u.must_change_password && <small>Masih password sementara</small>}{!u.is_verified && <small>Email belum diverifikasi</small>}</td>
                <td>{u.email}</td><td>{u.whatsapp}</td><td>{ROLE[u.role]}</td><td>{u.is_active ? "Aktif" : "Nonaktif"}</td>
                <td className="row-actions">
                  {u.id !== me && <button type="button" className={u.is_active ? "btn sm danger" : "btn sm"} disabled={act.busy} onClick={() => toggle(u)}>{u.is_active ? "Nonaktifkan" : "Aktifkan"}</button>}
                  <button type="button" className="btn sm" disabled={act.busy} onClick={() => temp(u)}>Password sementara</button>
                  {u.role === "guest" && u.is_active && <Link className="btn sm" to={`/client/baru?client=${u.id}`}>Buat proyek</Link>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      <form className="card form" onSubmit={create}>
        <h2>Buat akun admin</h2>
        <Field label="Nama" name="name" required />
        <Field label="Email" name="email" type="email" required />
        <Field label="Nomor WhatsApp" name="whatsapp" type="tel" required />
        <Message msg={add.msg} />
        <button className="btn pri" disabled={add.busy}>Buat admin</button>
      </form>
    </>
  )
}
