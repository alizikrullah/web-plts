import { useEffect, useState, type FormEvent } from "react"
import { Link, useParams } from "react-router"
import type { Params } from "../../../../shared/calc/rumah"
import { evaluate, TIER_LABEL, type SystemType, type Tier } from "../../../../shared/calc/simulator"
import { bepTxt, fmtNum, n1, rp } from "../../../../shared/format"
import { api } from "../../core/api"
import { useSession } from "../../core/session"
import { MapPicker, type Point } from "../../core/MapPicker"
import { Field, Loading } from "../../core/ui"
import { AdviceCard, CashCard, DayCard, FlowCard } from "./Results"
import { layTips, ONGRID_NOTE, PATTERNS } from "./simple"

export interface Simulation {
  id: string; created_at: string; is_locked: boolean; danger: boolean; pv_used_pct: number; params: Params
  system_type: SystemType; package_tier: Tier | null
  pln_power_va: number; monthly_bill: number; usage_pattern: string; panel_qty: number; battery_qty: number
  monthly_saving: number; bep_years: number | null; est_investment: number; capacity_kwp: number; daily_production_kwh: number
  snapshot: { panel: { name: string; wp: number }; inverter: { name: string }; battery: { name: string } | null
    accessories_estimate?: number; service_estimate?: number; battery_life_years?: number | null }
}

const date = (d: string) => new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" })
export const pattern = (id: string) => PATTERNS.find(p => p.id === id)?.label ?? "Beban diisi manual"

// Simulasi tersimpan (PRD 6.5): angka dibekukan sejak disimpan. Dari sini guest atau client mengajukan perhitungan detail.
export default function SavedSimulation() {
  const { id } = useParams(), session = useSession()
  const [sim, setSim] = useState<Simulation | null>(null), [error, setError] = useState("")
  useEffect(() => { api<{ simulation: Simulation }>(`/api/simulations/${id}`).then(r => setSim(r.simulation), err => setError(err.message)) }, [id])
  if (error) return <section className="wrap page"><p className="msg bad" role="alert">{error}</p></section>
  if (!sim || session.status !== "user") return <Loading />
  const e = evaluate(sim.params), admin = session.user.role === "admin", onGrid = sim.system_type === "on_grid", s = sim.snapshot
  const tips = admin ? e.tips : layTips(e.params, e.rows)

  return (
    <section className="wrap page">
      <div className="card">
        <h1>Simulasi tersimpan</h1>
        <p className="sub">Disimpan {date(sim.created_at)}. Angka di simulasi ini tidak berubah walaupun harga part berubah.</p>
        <dl className="info sum">
          <dt>Rumah</dt><dd>{fmtNum(sim.pln_power_va)} VA, tagihan {rp(sim.monthly_bill)} per bulan, {pattern(sim.usage_pattern).toLowerCase()}</dd>
          <dt>Sistem</dt><dd>{onGrid ? "On-grid" : "Hybrid atau off-grid"}, {sim.package_tier ? `paket ${TIER_LABEL[sim.package_tier]}` : "part diatur sendiri"}</dd>
          <dt>Panel</dt><dd>{sim.panel_qty} × {s.panel.name} ({n1(sim.capacity_kwp, 2)} kWp)</dd>
          <dt>Inverter</dt><dd>{s.inverter.name}</dd>
          {!onGrid && <><dt>Baterai</dt><dd>{s.battery ? `${sim.battery_qty} × ${s.battery.name}` : "Tanpa baterai"}
            {s.battery_life_years ? `, diganti tiap ±${s.battery_life_years} tahun` : ""}</dd></>}
          <dt>Produksi per hari</dt><dd>{n1(sim.daily_production_kwh)} kWh</dd>
          <dt>Hemat per bulan</dt><dd>{rp(sim.monthly_saving)}</dd>
          <dt>Balik modal</dt><dd>{bepTxt(sim.bep_years)}</dd>
          {s.accessories_estimate !== undefined && <><dt>Aksesoris (perkiraan)</dt><dd>{rp(s.accessories_estimate)}</dd></>}
          {s.service_estimate !== undefined && <><dt>Jasa (perkiraan)</dt><dd>{rp(s.service_estimate)}</dd></>}
          <dt>Estimasi investasi</dt><dd>{rp(sim.est_investment)}</dd>
        </dl>
        <p className="note">Estimasi kasar. Biaya final dihitung saat perhitungan detail.</p>
        {onGrid && <p className="note">{ONGRID_NOTE}</p>}
      </div>
      {!admin && <Submit sim={sim} />}
      <AdviceCard tips={tips} />
      <FlowCard sim={e.sim} />
      <DayCard sim={e.sim} />
      <CashCard p={e.params} inv={sim.est_investment} fin={e.fin} />
    </section>
  )
}

function Submit({ sim }: { sim: Simulation }) {
  const [open, setOpen] = useState(false), [done, setDone] = useState(false)
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [loc, setLoc] = useState<Point | null>(null)
  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.currentTarget))
    setBusy(true); setError("")
    try {
      await api(`/api/simulations/${sim.id}/submit`, { body: { address: f.address, city: f.city, request_note: f.request_note || null,
        latitude: loc?.lat ?? null, longitude: loc?.lng ?? null } })
      setDone(true)
    } catch (err) { setError((err as Error).message); setBusy(false) }
  }
  if (done) return <p className="msg ok" role="status">Permintaan Anda sedang ditinjau. Kami akan menghubungi lewat WhatsApp. <Link to="/">Kembali ke Home</Link></p>
  if (sim.is_locked) return <p className="msg warn">Simulasi ini sudah diajukan. <Link to="/">Lihat di Home</Link></p>
  return (
    <section className="card form">
      <h2>Lanjutkan ke perhitungan detail</h2>
      {sim.danger && <p className="msg bad">Ada saran berlabel Bahaya di simulasi ini, jadi belum bisa diajukan. <Link to="/simulator">Hitung ulang</Link></p>}
      {open && !sim.danger ? (
        <form className="form" onSubmit={submit}>
          <Field label="Alamat pemasangan" name="address" autoComplete="street-address" required />
          <Field label="Kota" name="city" autoComplete="address-level2" required />
          <div className="field"><span className="lbl">Lokasi pemasangan di peta (tidak wajib)</span><MapPicker value={loc} onChange={setLoc} /></div>
          <Field label="Catatan" name="request_note" hint="Boleh kosong. Misalnya jenis atap atau waktu yang enak dihubungi." />
          {error && <p className="msg bad" role="alert">{error}</p>}
          <button className="btn pri" disabled={busy}>{busy ? "Mengirim..." : "Kirim pengajuan"}</button>
        </form>
      ) : (
        <div className="actions">
          <button type="button" className="btn pri" disabled={sim.danger} onClick={() => setOpen(true)}>Lanjutkan ke perhitungan detail</button>
          <Link className="btn" to="/simulator">Hitung ulang</Link>
        </div>
      )}
      <p className="note">Belum mengikat. Harga final baru muncul setelah perhitungan detail.</p>
    </section>
  )
}
