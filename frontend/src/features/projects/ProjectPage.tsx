import { useState, type FormEvent } from "react"
import { Link, useParams, useSearchParams } from "react-router"
import { bepTxt, n1, rp } from "../../../../shared/format"
import { api } from "../../core/api"
import type { ProjectSummary } from "../../core/types"
import { MapPicker, MapView, type Point } from "../../core/MapPicker"
import { Field, Loading, Message, useAction, waLink } from "../../core/ui"
import { useApi } from "../../core/useApi"
import InvoicesTab from "../invoices/InvoicesTab"
import PlanningTab from "../planning/PlanningTab"
import PurchasesTab from "../purchases/PurchasesTab"
import StatusTab from "../status/StatusTab"

export interface Detail {
  project: ProjectSummary & { pic_admin_id: string | null; request_note: string | null; installed_kwp: number | null; latitude: number | null; longitude: number | null }
  client: { id: string; name: string; email: string; whatsapp: string; role: string; is_active: boolean }
  simulation: { id: string; capacity_kwp: number; panel_qty: number; monthly_saving: number; bep_years: number | null; est_investment: number; danger: boolean } | null
  warnings: string[]
}
const TABS = [["ringkasan", "Ringkasan"], ["planning", "Planning"], ["penagihan", "Penagihan"], ["status", "Status Pengerjaan"], ["pembelian", "Invoice Pembelian"]] as const

// Detail proyek untuk admin dengan lima tab (PRD 7.2).
export default function ProjectPage() {
  const { id } = useParams(), [params, setParams] = useSearchParams()
  const tab = params.get("tab") ?? "ringkasan"
  const d = useApi<Detail>(`/api/admin/projects/${id}`)
  if (d.error && !d.data) return <section className="wrap page"><p className="msg bad" role="alert">{d.error}</p></section>
  if (!d.data) return <Loading />
  const { project: p, client } = d.data

  return (
    <section className="wrap page">
      <div className="head">
        <div><h1>{p.code}, {p.name}</h1><p className="sub">{client.name} · {p.city} · <b>{p.status_name}</b>{p.sub_status_name && ` (${p.sub_status_name})`}</p></div>
        <Link to="/client">Semua proyek</Link>
      </div>
      {d.data.warnings.map(w => <p key={w} className="msg warn">{w}</p>)}
      <nav className="tabs" aria-label="Bagian proyek">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" aria-current={tab === k ? "page" : undefined} onClick={() => setParams({ tab: k }, { replace: true })}>{label}</button>
        ))}
      </nav>
      {tab === "ringkasan" && <Summary d={d.data} reload={d.reload} />}
      {tab === "planning" && <PlanningTab projectId={p.id} onChange={d.reload} />}
      {tab === "penagihan" && <InvoicesTab projectId={p.id} onChange={d.reload} />}
      {tab === "status" && <StatusTab projectId={p.id} admin onChange={d.reload} />}
      {tab === "pembelian" && <PurchasesTab projectId={p.id} admin onChange={d.reload} />}
    </section>
  )
}

function Summary({ d, reload }: { d: Detail; reload: () => void }) {
  const { project: p, client, simulation: s } = d
  const admins = useApi<{ users: { id: string; name: string; role: string; is_active: boolean }[] }>("/api/admin/users")
  const edit = useAction(), review = useAction()
  const [rejecting, setRejecting] = useState(false)
  const point = p.latitude !== null && p.longitude !== null ? { lat: p.latitude, lng: p.longitude } : null
  const [loc, setLoc] = useState<Point | null>(point)

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    edit.run(async () => {
      await api(`/api/admin/projects/${p.id}`, { method: "PATCH", body: { name: f.name, address: f.address, city: f.city, pic_admin_id: f.pic_admin_id || null,
        estimated_finish_date: f.estimated_finish_date || null, installed_kwp: f.installed_kwp ? Number(f.installed_kwp) : null, latitude: loc?.lat ?? null, longitude: loc?.lng ?? null } })
      reload()
    }, "Data proyek tersimpan.")
  }
  const accept = () => review.run(async () => { await api(`/api/admin/projects/${p.id}/accept`, { body: {} }); reload() })
  function reject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const reason = String(new FormData(e.currentTarget).get("reason"))
    review.run(async () => { await api(`/api/admin/projects/${p.id}/reject`, { body: { reason } }); reload() })
  }

  return (
    <>
      {p.status_key === "pengajuan" && (
        <div className="card form">
          <h2>Tinjau pengajuan</h2>
          <dl className="info sum">
            <dt>Alamat</dt><dd>{p.address}, {p.city}</dd>
            <dt>Catatan guest</dt><dd>{p.request_note ?? "-"}</dd>
          </dl>
          <MapView value={point} />
          {s?.danger && <p className="msg bad">Simulasi ini punya saran berlabel Bahaya.</p>}
          <Message msg={review.msg} />
          {rejecting ? (
            <form className="form" onSubmit={reject}>
              <Field label="Alasan penolakan" name="reason" required placeholder="Misalnya di luar area layanan" />
              <div className="actions"><button className="btn pri danger" disabled={review.busy}>Tolak pengajuan</button>
                <button type="button" className="btn" onClick={() => setRejecting(false)}>Batal</button></div>
            </form>
          ) : (
            <div className="actions">
              <button type="button" className="btn pri" disabled={review.busy} onClick={accept}>Terima pengajuan</button>
              <button type="button" className="btn danger" onClick={() => setRejecting(true)}>Tolak</button>
            </div>
          )}
          <p className="note">Terima: guest menjadi client, proyek pindah ke Planning, dan Anda menjadi penanggung jawabnya.</p>
        </div>
      )}
      {p.status_key === "ditolak" && <p className="msg warn">Pengajuan ditolak: {p.rejected_reason}</p>}

      <div className="card">
        <h2>Client</h2>
        <dl className="info sum">
          <dt>Nama</dt><dd>{client.name}{!client.is_active && " (nonaktif)"}</dd>
          <dt>Email</dt><dd>{client.email}</dd>
          <dt>WhatsApp</dt><dd><a href={waLink(client.whatsapp, `Halo ${client.name}, terkait proyek ${p.code}.`)} target="_blank" rel="noreferrer">{client.whatsapp}</a></dd>
          <dt>Role</dt><dd>{{ guest: "Guest", client: "Client", admin: "Admin" }[client.role] ?? client.role}</dd>
        </dl>
      </div>

      {s && (
        <div className="card">
          <h2>Simulasi yang diajukan</h2>
          <dl className="info sum">
            <dt>Kapasitas</dt><dd>{n1(s.capacity_kwp, 2)} kWp, {s.panel_qty} panel</dd>
            <dt>Hemat per bulan</dt><dd>{rp(s.monthly_saving)}</dd>
            <dt>Balik modal</dt><dd>{bepTxt(s.bep_years)}</dd>
            <dt>Estimasi investasi</dt><dd>{rp(s.est_investment)}</dd>
          </dl>
          <Link to={`/simulator/${s.id}`}>Lihat simulasi lengkap</Link>
        </div>
      )}

      {!["pengajuan", "ditolak"].includes(p.status_key) && (
        <form className="card form" onSubmit={save}>
          <h2>Data proyek</h2>
          <Field label="Nama proyek" name="name" defaultValue={p.name} required />
          <Field label="Alamat" name="address" defaultValue={p.address} required />
          <Field label="Kota" name="city" defaultValue={p.city} required />
          <div className="field"><span className="lbl">Lokasi pemasangan di peta</span><MapPicker value={loc} onChange={setLoc} /></div>
          <div className="field"><label htmlFor="pic">Penanggung jawab</label>
            <div className="box"><select id="pic" name="pic_admin_id" defaultValue={p.pic_admin_id ?? ""} key={admins.data ? "ok" : "load"}>
              <option value="">Belum ada</option>
              {admins.data?.users.filter(u => u.role === "admin" && u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></div></div>
          <Field label="Perkiraan selesai" name="estimated_finish_date" type="date" defaultValue={p.estimated_finish_date ?? ""} />
          <Field label="kWp terpasang" name="installed_kwp" type="number" step="0.01" min="0" defaultValue={p.installed_kwp ?? ""} hint="Kosongkan untuk dihitung dari Planning saat proyek Selesai." />
          <Message msg={edit.msg} />
          <button className="btn pri" disabled={edit.busy}>Simpan</button>
        </form>
      )}
    </>
  )
}
