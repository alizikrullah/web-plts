import { useEffect, useRef } from "react"
import type { Fin, Kind, Params, Row, Sim, Tip } from "../../../../shared/calc/rumah"
import { drawCash, drawDay } from "./charts"
import { bepTxt, n1, rp, rpS } from "../../../../shared/format"

// Gambar ulang saat ukuran berubah (termasuk saat tab baru terlihat) dan saat tema terang/gelap berganti.
function Canvas<T>({ draw, data, label }: { draw: (cv: HTMLCanvasElement, d: T) => void; data: T; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!
    const paint = () => { if (cv.clientWidth > 0) draw(cv, data) }
    const ro = new ResizeObserver(paint)
    ro.observe(cv)
    const mq = matchMedia("(prefers-color-scheme: dark)")
    mq.addEventListener("change", paint)
    return () => { ro.disconnect(); mq.removeEventListener("change", paint) }
  }, [draw, data])
  return <canvas ref={ref} className="chart" role="img" aria-label={label} />
}

const kwh = (v: number) => n1(Math.abs(v) < 0.05 ? 0 : v)

export function FlowCard({ sim }: { sim: Sim }) {
  const w = (v: number) => ({ width: sim.loadE > 0 ? `${(v / sim.loadE) * 100}%` : "0" })
  return (
    <section className="card">
      <h2>Aliran energi per hari</h2>
      <p className="sub">Beban AC OUT {n1(sim.loadE)} kWh/hari dipenuhi dari:</p>
      <div className="bar" aria-hidden="true">
        <i className="pv" style={w(sim.pvDirect)} /><i className="bt" style={w(sim.bat)} /><i className="gr" style={w(sim.grid)} />
      </div>
      <div className="flow">
        <div className="pv"><small>PV langsung ke beban</small><b>{kwh(sim.pvDirect)} kWh</b></div>
        <div className="bt"><small>Dari baterai</small><b>{kwh(sim.bat)} kWh</b></div>
        <div className="gr"><small>Tetap dari PLN</small><b>{kwh(sim.grid)} kWh</b></div>
        <div className="ws"><small>PV terbuang</small><b>{kwh(sim.waste + sim.clip)} kWh</b></div>
      </div>
      <p className="note">
        Produksi PV {n1(sim.dcDay)} kWh DC dari {n1(sim.wpTot / 1000, 2)} kWp · hemat {n1(sim.saved)} kWh/hari.
        Simulasi per 15 menit, hari cerah rata-rata.
      </p>
    </section>
  )
}

export function DayCard({ sim }: { sim: Sim }) {
  return (
    <section className="card">
      <h2>Profil 24 jam</h2>
      <p className="sub">Daya PV yang tersedia, beban, dan isi baterai.</p>
      <Canvas draw={drawDay} data={sim} label="Grafik daya PV, beban dan SOC baterai selama 24 jam" />
      <div className="legend">
        <span><i className="pv" />PV (AC)</span><span><i className="ld" />Beban</span>
        {sim.cap > 0 && <span><i className="soc" />SOC baterai</span>}
      </div>
    </section>
  )
}

export function CashCard({ p, inv, fin }: { p: Params; inv: number; fin: Fin }) {
  return (
    <section className="card">
      <h2>Arus kas kumulatif</h2>
      <p className="sub">
        Tahun 0 = modal {rp(inv)}. Hemat tahun pertama {rp(fin.y1)}, naik {n1(p.esc)}%/th mengikuti tarif.
        Untung bersih {n1(p.years, 0)} th: {rpS(fin.net)}.
      </p>
      <Canvas draw={drawCash} data={fin} label="Grafik arus kas kumulatif per tahun" />
      <div className="legend"><span><i className="neg" />Belum balik modal</span><span><i className="pos" />Sudah untung</span></div>
    </section>
  )
}

export function Options({ rows, best }: { rows: Row[]; best: Row | null }) {
  return (
    <section className="card">
      <h2>Bandingkan opsi</h2>
      <p className="sub">Semua opsi memakai beban dan tarif yang sama. Hijau = balik modal paling cepat.</p>
      <div className="opts">
        {rows.map(r => (
          <article key={r.name} className={r === best ? "opt best" : "opt"}>
            <header>
              <h3>{r.name}<small>{n1(r.s.wpTot / 1000, 2)} kWp</small></h3>
              {r === best && <span className="badge">Tercepat</span>}
            </header>
            <dl>
              <div><dt>Investasi</dt><dd>{rpS(r.i)}</dd></div>
              <div><dt>Hemat/bln</dt><dd>{rpS(r.f.month)}</dd></div>
              <div><dt>BEP</dt><dd>{bepTxt(r.f.bep)}</dd></div>
              <div><dt>Untung bersih</dt><dd>{rpS(r.f.net)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}

const LABEL: Record<Kind, string> = { ok: "Aman", warn: "Perhatikan", bad: "Bahaya", tip: "Saran" }

export function AdviceCard({ tips }: { tips: Tip[] }) {
  return (
    <section className="card">
      <h2>Saran</h2>
      <p className="sub">Dihitung otomatis dari isian Anda.</p>
      <ul className="advice">
        {tips.map((t, i) => <li key={i} className={t.kind}><b>{LABEL[t.kind]}</b>{t.text}</li>)}
      </ul>
    </section>
  )
}
