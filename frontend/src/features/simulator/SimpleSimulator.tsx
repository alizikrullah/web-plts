import { useEffect, useMemo, useState, type ReactNode } from "react"
import { FaWhatsapp } from "react-icons/fa"
import { LuBatteryCharging, LuCircleCheck, LuRotateCcw, LuTriangleAlert, LuZap } from "react-icons/lu"
import { TbSolarPanel } from "react-icons/tb"
import { Link, useNavigate } from "react-router"
import { arrangements, evaluate, investment, toParams } from "../../../../shared/calc/simulator"
import { bepTxt, fmtNum, n1, parseNum, rp, rpS } from "../../../../shared/format"
import { api } from "../../core/api"
import { useSession } from "../../core/session"
import { waLink } from "../../core/ui"
import { Field, Group } from "./Inputs"
import { AdviceCard, CashCard, DayCard, FlowCard } from "./Results"
import { batteriesFor, compareSimple, configBody, fix, hybridInverters, layTips, loadState, PATTERNS, recommended, saveState, toConfig, type SimData, type SimpleState } from "./simple"
import { Select, SimShell } from "./SimulatorPage"

const ESTIMATE_LABEL = "Estimasi kasar. Biaya final dihitung saat perhitungan detail."

function initial(d: SimData): SimpleState | null {
  const saved = loadState(), plns = Object.keys(d.s.tariff_per_va)
  const base = { type: saved.type ?? "hybrid", pln: saved.pln && plns.includes(String(saved.pln)) ? saved.pln : plns.includes("2200") ? 2200 : Number(plns[0]),
    bill: saved.bill ?? 1_000_000, pattern: saved.pattern ?? "seimbang" } as const
  if (saved.panelId && saved.inverterId) {
    const st = fix(d, { ...base, ...saved } as SimpleState)
    if (toConfig(d, st)) return st
  }
  return recommended(d, base)
}

// Mode sederhana (PRD 6.1 sampai 6.5).
export default function SimpleSimulator({ d }: { d: SimData }) {
  const session = useSession(), navigate = useNavigate()
  const [st, setSt] = useState(() => initial(d))
  const [billText, setBillText] = useState(() => fmtNum(st?.bill ?? 0))
  const [saveError, setSaveError] = useState(""), [busy, setBusy] = useState(false)
  useEffect(() => { if (st) saveState(st) }, [st])

  const config = st && toConfig(d, st)
  const e = useMemo(() => (config ? evaluate(toParams(config, d.s)) : null), [config?.panel.id, config?.panel_qty, config?.inverter.id, config?.battery?.id,
    config?.battery_qty, st?.pln, st?.bill, st?.pattern])
  if (!st) return <section className="wrap page"><p className="msg bad">Belum ada panel dan inverter aktif di List Part.</p></section>

  const rec = recommended(d, st)
  // Isian rumah berubah: pilihan part diisi ulang dari rekomendasi.
  const setBase = (patch: Partial<SimpleState>) => { const next = { ...st, ...patch }; setSt(recommended(d, next) ?? next) }
  const setPart = (patch: Partial<SimpleState>) => setSt(fix(d, { ...st, ...patch }))
  const panel = d.parts.panels.find(p => p.id === st.panelId), inverter = d.parts.inverters.find(i => i.id === st.inverterId)
  const qtys = panel && inverter ? arrangements(panel, inverter) : [], arr = qtys.find(a => a.qty === st.qty)
  const bats = batteriesFor(d, inverter), battery = bats.find(b => b.id === st.batteryId) ?? null
  const kwp = panel ? (st.qty * panel.wp) / 1000 : 0
  const isRec = !!rec && rec.panelId === st.panelId && rec.qty === st.qty && rec.inverterId === st.inverterId && rec.batteryId === st.batteryId && rec.batteryQty === st.batteryQty
  const fits = hybridInverters(d).some(i => i.rated_w >= st.pln)

  async function save() {
    setBusy(true); setSaveError("")
    try {
      const { simulation } = await api<{ simulation: { id: string } }>("/api/simulations", { body: configBody(config!) })
      navigate(`/simulator/${simulation.id}`)
    } catch (err) { setSaveError((err as Error).message); setBusy(false) }
  }

  const input = (
    <>
      <Group title="Jenis sistem" summary={st.type === "hybrid" ? "Hybrid atau off-grid" : "On-grid"}>
        <div className="field full">
          <div className="seg" role="group" aria-label="Jenis sistem">
            <button type="button" aria-pressed={st.type === "hybrid"} onClick={() => setSt({ ...st, type: "hybrid" })}>Hybrid / off-grid</button>
            <button type="button" aria-pressed={st.type === "ongrid"} onClick={() => setSt({ ...st, type: "ongrid" })}>On-grid</button>
          </div>
          <span className="hint">Hybrid dan off-grid memakai baterai (boleh tanpa baterai). On-grid tanpa baterai.</span>
        </div>
      </Group>

      {st.type === "ongrid" ? (
        <section className="card">
          <h2>Simulasi on-grid belum tersedia</h2>
          <p className="sub">Perhitungan on-grid menyusul. Tanya langsung ke tim kami lewat WhatsApp.</p>
          {d.whatsapp
            ? <a className="btn pri" href={waLink(d.whatsapp, "Halo, saya ingin bertanya tentang PLTS on-grid.")} target="_blank" rel="noreferrer"><FaWhatsapp aria-hidden />Tanya lewat WhatsApp</a>
            : <p className="note">Nomor WhatsApp belum diisi tim.</p>}
        </section>
      ) : (
        <>
          <Group title="Rumah Anda" summary={`${fmtNum(st.pln)} VA · tagihan ${rpS(st.bill)}`}>
            <Select label="Daya PLN" value={String(st.pln)} onChange={v => setBase({ pln: Number(v) })}
              options={Object.keys(d.s.tariff_per_va).sort((a, b) => +a - +b).map(v => ({ value: v, label: `${fmtNum(+v)} VA` }))} />
            <Field id="tagihan" label="Tagihan listrik per bulan" pre="Rp" unit="/bln" big full value={billText}
              onValue={v => { setBillText(v); setBase({ bill: Math.max(0, Math.round(parseNum(v))) }) }} />
            <Select label="Pola pemakaian" value={st.pattern} onChange={v => setBase({ pattern: v as SimpleState["pattern"] })}
              options={PATTERNS.map(p => ({ value: p.id, label: p.label }))} hint="Siang = jam 08 sampai 16." />
          </Group>

          <Group title="Part" summary={panel && inverter ? `${st.qty} panel · ${n1(kwp, 2)} kWp · ${battery ? `${st.batteryQty} baterai` : "tanpa baterai"}` : "Pilih part"}>
            <div className="part-note">
              <span>{isRec ? "Dipilih otomatis dari daya PLN dan tagihan Anda. Silakan ganti kalau perlu." : "Pilihan part sudah Anda ubah."}</span>
              {rec && !isRec && <button type="button" className="btn sm" onClick={() => setSt(rec)}><LuRotateCcw aria-hidden />Pakai rekomendasi</button>}
            </div>
            <ul className="part-list">
              <PartRow icon={<TbSolarPanel />} label="Panel" total={panel && rp(panel.unit_price * st.qty)}
                select={<Choice label="Panel" value={st.panelId} onChange={v => setPart({ panelId: v })}
                  options={d.parts.panels.map(p => ({ value: p.id, label: `${p.name} (${rp(p.unit_price)})` }))} />}
                qty={qtys.length > 0 && <Choice qty label="Jumlah panel" value={String(st.qty)} onChange={v => setPart({ qty: Number(v) })}
                  options={qtys.map(a => ({ value: String(a.qty), label: `${a.qty} panel` }))} />}
                meta={panel && arr && `${fmtNum(panel.wp)} Wp per panel · total ${n1(kwp, 2)} kWp · ${arr.series} seri × ${arr.parallel} string`}
                why={!qtys.length ? <Why warn>Panel ini tidak cocok dengan inverter terpilih.</Why>
                  : rec?.panelId === st.panelId && rec.qty === st.qty && <Why><b>Rekomendasi:</b> jumlah panel dengan balik modal tercepat.</Why>} />
              <PartRow icon={<LuZap />} label="Inverter" total={inverter && rp(inverter.unit_price)}
                select={<Choice label="Inverter" value={st.inverterId} onChange={v => setPart({ inverterId: v })}
                  options={hybridInverters(d).map(i => ({ value: i.id, label: `${i.name} (${rp(i.unit_price)})` }))} />}
                meta={inverter && `Daya ${fmtNum(inverter.rated_w)} W${inverter.battery_system_v ? ` · sistem baterai ${inverter.battery_system_v} V` : ""}`}
                why={!fits ? <Why warn>Belum ada inverter yang cukup besar untuk daya PLN rumah ini. Silakan hubungi admin.</Why>
                  : rec?.inverterId === st.inverterId && <Why><b>Rekomendasi:</b> inverter terkecil yang dayanya minimal {fmtNum(st.pln)} VA.</Why>} />
              <PartRow icon={<LuBatteryCharging />} label="Baterai" total={battery ? rp(battery.unit_price * st.batteryQty) : undefined}
                select={<Choice label="Baterai" value={st.batteryId ?? ""} onChange={v => setPart({ batteryId: v || null })}
                  options={[...bats.map(b => ({ value: b.id, label: `${b.name} (${rp(b.unit_price)})` })), { value: "", label: "Tanpa baterai" }]} />}
                qty={battery && <Choice qty label="Jumlah baterai" value={String(st.batteryQty)} onChange={v => setPart({ batteryQty: Number(v) })}
                  options={[1, 2, 3, 4].map(n => ({ value: String(n), label: `${n} unit` }))} />}
                meta={battery && `${fmtNum(battery.voltage_v)} V · ${fmtNum(battery.capacity_ah)} Ah per unit`}
                why={!bats.length ? <Why warn>Belum ada baterai yang cocok dengan inverter ini.</Why>
                  : rec?.batteryId && rec.batteryId === st.batteryId && rec.batteryQty === st.batteryQty
                  && <Why><b>Rekomendasi:</b> cocok dengan tegangan inverter dan harganya paling rendah.</Why>} />
            </ul>
          </Group>

          {config && e && <Summary d={d} config={config} e={e} />}

          <section className="card form">
            <h2>Simpan simulasi</h2>
            {session.status === "user" ? (
              <>
                <p className="sub">Simpan dulu, lalu lanjutkan ke perhitungan detail dari simulasi tersimpan.</p>
                {saveError && <p className="msg bad" role="alert">{saveError}</p>}
                <button type="button" className="btn pri" disabled={!config || busy} onClick={save}>{busy ? "Menyimpan..." : "Simpan simulasi"}</button>
              </>
            ) : (
              <>
                <p className="sub">Daftar atau masuk untuk menyimpan simulasi dan mengajukan perhitungan detail. Isian Anda tetap tersimpan di browser ini.</p>
                <div className="actions">
                  <Link className="btn pri" to="/daftar" state={{ from: "/simulator" }}>Daftar untuk menyimpan</Link>
                  <Link className="btn" to="/masuk" state={{ from: "/simulator" }}>Masuk</Link>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </>
  )

  const show = st.type === "hybrid" && config && e
  return (
    <SimShell title="Simulator PLTS Rumah" sub="Hitung produksi, penghematan, dan balik modal"
      kpi={show ? { saving: e.result.monthly_saving, bep: e.result.bep_years, pvUsed: e.pv_used_pct, invest: e.result.est_investment } : null}
      alerts={show ? layTips(e.params, e.rows).filter(t => t.kind === "bad" || t.kind === "warn").length : 0}
      input={input}
      hasil={show && <><FlowCard sim={e.sim} /><DayCard sim={e.sim} /><CashCard p={e.params} inv={e.result.est_investment} fin={e.fin} /></>}
      opsi={show && <Compare d={d} config={config} />}
      saran={show && <AdviceCard tips={layTips(e.params, e.rows)} />}
    />
  )
}

// Satu baris part: nama dan subtotal, pilihan, jumlah, angka penting, lalu alasan rekomendasi (PRD 6.2).
function PartRow({ icon, label, total, select, qty, meta, why }: {
  icon: ReactNode; label: string; total?: string; select: ReactNode; qty?: ReactNode; meta?: string | null; why?: ReactNode
}) {
  return (
    <li className="part">
      <span className="part-icon" aria-hidden="true">{icon}</span>
      <div className="part-body">
        <div className="part-top"><label htmlFor={idOf(label)}>{label}</label>{total && <b>{total}</b>}</div>
        {select}
        {(qty || meta) && <div className="part-sub">{qty}{meta && <span className="part-meta">{meta}</span>}</div>}
        {why}
      </div>
    </li>
  )
}
const idOf = (label: string) => "sel-" + label.toLowerCase().replace(/\W+/g, "-")
function Choice({ label, value, onChange, options, qty }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; qty?: boolean }) {
  return (
    <div className={qty ? "box qty" : "box"}>
      <select id={qty ? undefined : idOf(label)} aria-label={qty ? label : undefined} value={value} onChange={e => onChange(e.target.value)}
        title={options.find(o => o.value === value)?.label}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}
const Why = ({ warn, children }: { warn?: boolean; children: ReactNode }) => (
  <p className={warn ? "part-why warn" : "part-why"}>{warn ? <LuTriangleAlert aria-hidden /> : <LuCircleCheck aria-hidden />}<span>{children}</span></p>
)

function Summary({ d, config, e }: { d: SimData; config: NonNullable<ReturnType<typeof toConfig>>; e: ReturnType<typeof evaluate> }) {
  const inv = investment(config.panel, config.panel_qty, config.inverter, config.battery, config.battery_qty, d.s)
  return (
    <section className="card">
      <h2>Ringkasan</h2>
      <dl className="info sum">
        <dt>Kapasitas</dt><dd>{config.panel_qty} × {fmtNum(config.panel.wp)} Wp = {n1(e.result.capacity_kwp, 2)} kWp</dd>
        <dt>Produksi per hari</dt><dd>{n1(e.result.daily_production_kwh)} kWh</dd>
        <dt>Hemat per bulan</dt><dd data-testid="hemat">{rp(e.result.monthly_saving)}</dd>
        <dt>Balik modal</dt><dd>{bepTxt(e.result.bep_years)}</dd>
        <dt>Estimasi investasi</dt><dd>{rp(e.result.est_investment)}</dd>
      </dl>
      <p className="note">{ESTIMATE_LABEL} Terdiri dari panel, inverter, dan baterai {rp(inv.components)}, aksesoris {fmtNum(d.s.accessories_estimate_pct)}% {rp(inv.accessories)},
        dan jasa instalasi {rp(inv.installation)}.{d.installationMissing && " Estimasi jasa instalasi belum diisi tim, jadi belum termasuk."}</p>
    </section>
  )
}

function Compare({ d, config }: { d: SimData; config: NonNullable<ReturnType<typeof toConfig>> }) {
  const rows = compareSimple(config, d.s)
  const best = rows.filter(r => r.bep !== null).sort((a, b) => a.bep! - b.bep!)[0]
  const most = Math.max(...arrangements(config.panel, config.inverter).map(a => a.qty))
  return (
    <section className="card">
      <h2>Bandingkan pilihan</h2>
      <p className="sub">Semua pilihan memakai tagihan dan pola pemakaian yang sama. Hijau = balik modal paling cepat.</p>
      <div className="opts">
        {rows.map(r => (
          <article key={r.name} className={r === best ? "opt best" : "opt"}>
            <header><h3>{r.name}<small>{n1(r.kwp, 2)} kWp</small></h3>{r === best && <span className="badge">Tercepat</span>}</header>
            <dl>
              <div><dt>Investasi</dt><dd>{rpS(r.invest)}</dd></div>
              <div><dt>Hemat/bln</dt><dd>{rpS(r.saving)}</dd></div>
              <div><dt>BEP</dt><dd>{bepTxt(r.bep)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      {most > config.panel_qty && <p className="note">Inverter ini masih bisa menampung {most - config.panel_qty} panel lagi.</p>}
      <p className="note">Tanpa baterai, kelebihan listrik dari panel tidak tersimpan.</p>
    </section>
  )
}
