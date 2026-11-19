import type { ReactNode } from "react"
import { FaWhatsapp } from "react-icons/fa"
import { Link } from "react-router"
import { bepTxt, rpS } from "../../../../shared/format"
import { waLink } from "../../core/ui"

export interface HomeSimulation { id: string; is_locked: boolean; monthly_saving: number; bep_years: number | null }
export interface HomeProject { id: string; code: string; status_key: string; rejected_reason: string | null }

export function Card({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <section className="card next">
      <h2>Langkah berikutnya</h2>
      <p>{children}</p>
      <div className="actions">{actions}</div>
    </section>
  )
}
export const chat = (wa: string | null, text: string) =>
  wa ? <a className="btn" href={waLink(wa, text)} target="_blank" rel="noreferrer"><FaWhatsapp aria-hidden />Chat admin</a> : null

// Kartu Langkah berikutnya untuk guest (PRD 5.1). Dipakai juga client untuk proyek berstatus Pengajuan atau Ditolak (PRD 5.2).
export function GuestNextStep({ projects, sim, wa, name }: { projects: HomeProject[]; sim: HomeSimulation | null; wa: string | null; name: string }) {
  const pending = projects.find(p => p.status_key === "pengajuan")
  const rejected = projects[0]?.status_key === "ditolak" ? projects[0] : null
  const recount = <Link className="btn" to="/simulator">Hitung ulang</Link>
  if (pending)
    return <Card actions={chat(wa, `Halo, saya ${name}. Saya ingin menanyakan pengajuan ${pending.code}.`)}>Permintaan Anda sedang ditinjau. Kami akan menghubungi lewat WhatsApp.</Card>
  if (sim && !sim.is_locked)
    return (
      <Card actions={<><Link className="btn pri" to={`/simulator/${sim.id}`}>Lanjutkan ke perhitungan detail</Link>{recount}</>}>
        Estimasi: hemat ± {rpS(sim.monthly_saving)} per bulan, balik modal ± {bepTxt(sim.bep_years)}. Mau lanjut ke perhitungan detail?
      </Card>
    )
  if (rejected)
    return <Card actions={<>{chat(wa, `Halo, saya ${name}. Saya ingin menanyakan pengajuan ${rejected.code}.`)}{recount}</>}>Pengajuan belum bisa kami proses: {rejected.rejected_reason}.</Card>
  return <Card actions={<Link className="btn pri" to="/simulator">Buka Simulator</Link>}>Mulai dari simulasi untuk tahu estimasi hemat Anda.</Card>
}
