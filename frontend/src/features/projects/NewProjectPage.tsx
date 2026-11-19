import { useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router"
import { MapPicker, type Point } from "../../core/MapPicker"
import { api } from "../../core/api"
import { Field, Message, useAction } from "../../core/ui"
import { useApi } from "../../core/useApi"

interface User { id: string; name: string; email: string; role: string; is_active: boolean }

// Client atau proyek baru untuk client yang datang lewat WhatsApp (PRD 7.1). Proyek langsung di status Planning.
// Client baru mendapat password sementara yang wajib diganti saat masuk pertama (PRD bagian 4).
export default function NewProjectPage() {
  const preset = useSearchParams()[0].get("client")
  const [mode, setMode] = useState<"baru" | "lama">(preset ? "lama" : "baru"), [q, setQ] = useState(""), [loc, setLoc] = useState<Point | null>(null)
  const users = useApi<{ users: User[] }>(mode === "lama" ? `/api/admin/users?q=${encodeURIComponent(q)}` : null)
  const [done, setDone] = useState<{ project: { id: string; code: string }; temporary_password?: string } | null>(null)
  const act = useAction()

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    const body = { name: f.name, address: f.address, city: f.city, request_note: f.request_note || null, latitude: loc?.lat ?? null, longitude: loc?.lng ?? null,
      ...(mode === "baru" ? { client: { name: f.client_name, email: f.client_email, whatsapp: f.client_whatsapp } } : { client_id: f.client_id }) }
    act.run(async () => setDone(await api("/api/admin/projects", { body })))
  }

  if (done) return (
    <section className="wrap page narrow">
      <div className="card form">
        <h1>Proyek {done.project.code} dibuat</h1>
        <p className="sub">Proyek langsung berstatus Planning.</p>
        {done.temporary_password && <p className="msg warn">Password sementara client: <b>{done.temporary_password}</b>. Kirim ke client lewat WhatsApp. Client wajib menggantinya saat masuk pertama.</p>}
        <Link className="btn pri" to={`/client/${done.project.id}?tab=planning`}>Buka planning</Link>
      </div>
    </section>
  )
  return (
    <section className="wrap page narrow">
      <h1>Client atau proyek baru</h1>
      <form className="card form" onSubmit={submit}>
        <h2>Client</h2>
        <div className="seg" role="group" aria-label="Jenis client">
          <button type="button" aria-pressed={mode === "baru"} onClick={() => setMode("baru")}>Client baru</button>
          <button type="button" aria-pressed={mode === "lama"} onClick={() => setMode("lama")}>Client yang sudah ada</button>
        </div>
        {mode === "baru" ? (
          <>
            <Field label="Nama client" name="client_name" required />
            <Field label="Email client" name="client_email" type="email" required />
            <Field label="Nomor WhatsApp client" name="client_whatsapp" type="tel" required />
          </>
        ) : (
          <>
            <div className="field"><label htmlFor="cari-client">Cari akun</label>
              <div className="box"><input id="cari-client" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Nama, email, atau nomor" /></div></div>
            <div className="field"><label htmlFor="pilih-client">Akun client</label>
              <div className="box"><select id="pilih-client" name="client_id" required defaultValue={preset ?? undefined} key={users.data ? "ok" : "muat"}>
                {users.data?.users.filter(u => u.role !== "admin" && u.is_active).map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select></div></div>
          </>
        )}
        <h2>Proyek</h2>
        <Field label="Nama proyek" name="name" defaultValue="PLTS Rumah" required />
        <Field label="Alamat pemasangan" name="address" required />
        <Field label="Kota" name="city" required />
        <div className="field"><span className="lbl">Lokasi pemasangan di peta (tidak wajib)</span><MapPicker value={loc} onChange={setLoc} /></div>
        <Field label="Catatan" name="request_note" />
        <Message msg={act.msg} />
        <button className="btn pri" disabled={act.busy}>Buat proyek</button>
      </form>
    </section>
  )
}
