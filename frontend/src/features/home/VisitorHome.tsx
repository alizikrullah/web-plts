import { FaWhatsapp } from "react-icons/fa"
import { Link } from "react-router"
import { n1 } from "../../../../shared/format"
import { useSession } from "../../core/session"
import type { PublicSettings } from "../../core/types"
import { waLink } from "../../core/ui"
import { useApi } from "../../core/useApi"
import { GuestNextStep, type HomeProject, type HomeSimulation } from "./NextStep"

const STEPS = ["Simulasi", "Persetujuan", "Perhitungan detail", "Pemasangan"]

// Home pengunjung dan guest (PRD 5.1). Blok yang datanya belum ada disembunyikan.
export default function VisitorHome() {
  const session = useSession()
  const pub = useApi<PublicSettings>("/api/settings/public")
  const stats = useApi<{ show: boolean; finished_projects?: number; installed_kwp?: number }>("/api/home/stats")
  const home = useApi<{ simulation: HomeSimulation | null; projects: HomeProject[] }>(session.status === "user" ? "/api/home" : null)
  const wa: string | null = pub.data?.settings.whatsapp_number ?? null
  const area: string | null = pub.data?.settings.service_area_text ?? null
  const faqs = pub.data?.faqs.slice(0, 5) ?? []

  return (
    <section className="wrap page">
      {session.status === "user" && home.data && <GuestNextStep projects={home.data.projects} sim={home.data.simulation} wa={wa} name={session.user.name} />}
      <div className="card hero">
        <h1>Berapa listrik yang bisa Anda hemat dengan panel surya?</h1>
        <p>Hitung sendiri di sini.</p>
        <div className="actions">
          <Link className={session.status === "user" ? "btn" : "btn pri"} to="/simulator">Coba Simulator</Link>
          {session.status === "anon" && <Link className="btn" to="/masuk">Masuk</Link>}
        </div>
      </div>
      <div className="card">
        <h2>Cara kerja</h2>
        <ol className="steps">{STEPS.map(s => <li key={s}>{s}</li>)}</ol>
        <p className="note">Harga di simulator adalah estimasi kasar. Biaya final dihitung saat perhitungan detail karena tergantung lokasi dan jumlah tenaga kerja.</p>
      </div>
      {area && (
        <div className="card">
          <h2>Area layanan</h2>
          <p className="pre">{area}</p>
          {wa && <p className="sub"><a href={waLink(wa, "Halo, apakah lokasi saya bisa dilayani?")} target="_blank" rel="noreferrer">Di luar daftar? Tanya lewat WhatsApp</a></p>}
        </div>
      )}
      {stats.data?.show && (
        <div className="card">
          <h2>Sudah terpasang</h2>
          <dl className="stats">
            <div><dt>Proyek selesai</dt><dd>{stats.data.finished_projects}</dd></div>
            <div><dt>Total terpasang</dt><dd>{n1(stats.data.installed_kwp ?? 0, 1)} kWp</dd></div>
          </dl>
        </div>
      )}
      {faqs.length > 0 && (
        <div className="card faq">
          <h2>Pertanyaan yang sering ditanyakan</h2>
          {faqs.map(f => <details key={f.id}><summary>{f.question}</summary><p className="pre">{f.answer}</p></details>)}
        </div>
      )}
      {wa && <a className="wa-float" href={waLink(wa, "Halo, saya ingin bertanya tentang pemasangan PLTS.")} target="_blank" rel="noreferrer" aria-label="Chat lewat WhatsApp" title="Chat lewat WhatsApp"><FaWhatsapp aria-hidden /></a>}
    </section>
  )
}
