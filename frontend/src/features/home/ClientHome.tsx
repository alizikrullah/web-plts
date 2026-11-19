import { useState } from "react"
import { FaWhatsapp } from "react-icons/fa"
import { Link } from "react-router"
import { bepTxt, n1, rp, rpS } from "../../../../shared/format"
import type { User } from "../../core/api"
import type { ProjectSummary, PublicSettings } from "../../core/types"
import { Loading, waLink } from "../../core/ui"
import { dateText, daysAgo, useApi } from "../../core/useApi"
import { Card, chat, GuestNextStep, type HomeSimulation } from "./NextStep"

// Catatan admin dipakai di tengah kalimat, jadi tanda baca di ujungnya dibuang.
const bare = (s: string) => s.replace(/[.!?]+s*$/, "")

// Dashboard client (PRD 5.2).
export default function ClientHome({ user }: { user: User }) {
  const home = useApi<{ simulation: HomeSimulation | null; projects: ProjectSummary[] }>("/api/home")
  const pub = useApi<PublicSettings>("/api/settings/public")
  const [selected, setSelected] = useState("")
  if (!home.data) return <Loading />
  const projects = home.data.projects, p = projects.find(x => x.id === selected) ?? projects[0]
  const wa: string | null = p?.pic?.whatsapp ?? pub.data?.settings.whatsapp_number ?? null

  return (
    <section className="wrap page">
      <div className="card">
        <h1>Halo, {user.name}</h1>
        {p && <p className="sub">Proyek {p.code}, {p.name}</p>}
        {projects.length > 1 && (
          <div className="field"><label htmlFor="pilih-proyek">Pilih proyek</label>
            <div className="box"><select id="pilih-proyek" value={p.id} onChange={e => setSelected(e.target.value)}>
              {projects.map(x => <option key={x.id} value={x.id}>{x.code}, {x.name}</option>)}
            </select></div></div>
        )}
      </div>
      {p && <ClientNextStep p={p} sim={home.data.simulation} wa={wa} name={user.name} />}
      {p && !["pengajuan", "ditolak"].includes(p.status_key) && <ProjectCard p={p} />}
      {p?.simulation && p.accepted_at && (
        <div className="card">
          <h2>Simulasi yang disetujui</h2>
          <p className="sub">Disetujui {dateText(p.accepted_at)}</p>
          <dl className="info sum">
            <dt>Kapasitas</dt><dd>{n1(p.simulation.capacity_kwp, 2)} kWp, {p.simulation.panel_qty} panel</dd>
            <dt>Produksi per hari</dt><dd>{n1(p.simulation.daily_production_kwh)} kWh</dd>
            <dt>Hemat per bulan</dt><dd>{rp(p.simulation.monthly_saving)}</dd>
            <dt>Balik modal</dt><dd>{bepTxt(p.simulation.bep_years)}</dd>
            <dt>Estimasi investasi</dt><dd>{rp(p.simulation.est_investment)}</dd>
          </dl>
        </div>
      )}
      {p && p.purchases.count > 0 && (
        <div className="card">
          <h2>Invoice pembelian</h2>
          <dl className="info sum">
            <dt>Jumlah pembelian</dt><dd>{p.purchases.count}</dd>
            <dt>Total belanja</dt><dd>{rp(p.purchases.total_paid)}</dd>
            <dt>Pembelian terakhir</dt><dd>{dateText(p.purchases.last_date)}</dd>
          </dl>
          <Link to={`/invoice-pembelian?proyek=${p.id}`}>Lihat invoice pembelian</Link>
        </div>
      )}
      {p && wa && (
        <div className="card">
          <h2>Hubungi kami</h2>
          <p className="sub">{p.pic ? `Penanggung jawab proyek: ${p.pic.name}` : "Tim kami siap membantu lewat WhatsApp."}</p>
          <a className="btn pri" href={waLink(wa, `Halo, saya ingin menanyakan proyek ${p.code}.`)} target="_blank" rel="noreferrer"><FaWhatsapp aria-hidden />Chat lewat WhatsApp</a>
        </div>
      )}
    </section>
  )
}

function ClientNextStep({ p, sim, wa, name }: { p: ProjectSummary; sim: HomeSimulation | null; wa: string | null; name: string }) {
  const status = <Link className="btn pri" to={`/status-pengerjaan?proyek=${p.id}`}>Lihat status</Link>
  if (p.status_key === "pengajuan" || p.status_key === "ditolak")
    return <GuestNextStep projects={[p]} sim={p.status_key === "ditolak" ? sim : null} wa={wa} name={name} />
  if (p.status_key === "planning")
    return <Card actions={chat(wa, `Halo, saya ingin menanyakan proyek ${p.code}.`)}>Tim kami sedang menyusun perhitungan detail sesuai lokasi Anda.</Card>
  if (p.status_key === "menunggu_pembayaran")
    return <Card actions={status}>Tagihan sudah terbit. Harga berlaku sampai {dateText(p.initial_invoice?.price_valid_until)}.</Card>
  if (p.status_key === "selesai")
    return <Card actions={<Link className="btn pri" to={`/invoice-pembelian?proyek=${p.id}`}>Lihat invoice pembelian</Link>}>
      Proyek selesai. Invoice pembelian dan rekap biaya tetap bisa dilihat di sini.</Card>
  const u = p.last_update
  return <Card actions={status}>Update terakhir: {bare(u?.note ?? p.sub_status_name ?? p.status_name)} ({u ? daysAgo(u.at) : "-"}).</Card>
}

// Kartu proyek: alamat singkat, tahap dengan tanggal masuk, sub-status, update terakhir, dan perkiraan selesai.
export function ProjectCard({ p }: { p: ProjectSummary }) {
  const current = p.stages.findIndex(s => s.status_key === p.status_key)
  return (
    <div className="card">
      <h2>Proyek {p.code}</h2>
      <p className="sub">{p.address}, {p.city}</p>
      <ol className="stages">
        {p.stages.map((s, i) => (
          <li key={s.status_key} className={i < current ? "done" : i === current ? "now" : ""} aria-current={i === current ? "step" : undefined}>
            <b>{s.name}</b><small>{s.entered_at ? dateText(s.entered_at) : "Belum"}</small>
          </li>
        ))}
      </ol>
      <dl className="info sum">
        {p.sub_status_name && <><dt>Sub-status</dt><dd>{p.sub_status_name}</dd></>}
        {p.last_update && <><dt>Update terakhir</dt><dd>{bare(p.last_update.note ?? p.status_name)}, {daysAgo(p.last_update.at)}</dd></>}
        {p.estimated_finish_date && <><dt>Perkiraan selesai</dt><dd>{dateText(p.estimated_finish_date)}</dd></>}
        {p.initial_invoice && <><dt>Tagihan</dt><dd>{p.initial_invoice.number}, {rpS(p.initial_invoice.total)} ({p.initial_invoice.status === "lunas" ? "lunas" : "belum lunas"})</dd></>}
      </dl>
    </div>
  )
}
