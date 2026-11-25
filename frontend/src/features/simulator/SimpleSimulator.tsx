import { useEffect, useMemo, useState, type ReactNode } from "react"
import { FaWhatsapp } from "react-icons/fa"
import { LuBatteryCharging, LuCircleCheck, LuRotateCcw, LuSlidersHorizontal, LuTriangleAlert, LuZap } from "react-icons/lu"
import { TbSolarPanel } from "react-icons/tb"
import { Link, useNavigate } from "react-router"
import { arrangements, evaluate, investment, isOnGrid, TIER_LABEL, toParams, type Config, type Package, type Tier } from "../../../../shared/calc/simulator"
import { bepTxt, fmtNum, n1, parseNum, rp, rpS } from "../../../../shared/format"
import { api } from "../../core/api"
import { useSession } from "../../core/session"
import { waLink } from "../../core/ui"
import { Field, Group } from "./Inputs"
import { AdviceCard, CashCard, DayCard, FlowCard } from "./Results"
import { batteriesFor, choosePackage, configBody, fix, fromPackage, invertersOf, layTips, loadState, ONGRID_NOTE, packagesFor, PATTERNS, saveState, systemOf,
  toConfig, type Base, type SimData, type SimpleState } from "./simple"
import { Select, SimShell } from "./SimulatorPage"

const ESTIMATE_LABEL = "Estimasi kasar. Biaya final dihitung saat perhitungan detail."
const NO_BATTERY_NOTE = "Tanpa baterai, kelebihan listrik dari panel tidak tersimpan."
const EMPTY = { tier: null, panelId: "", qty: 0, inverterId: "", batteryId: null, batteryQty: 1 } as const

function initial(d: SimData): SimpleState {
  const saved = loadState(), plns = Object.keys(d.s.tariff_per_va)
  const base: Base = { type: saved.type === "ongrid" ? "ongrid" : "hybrid", pln: saved.pln && plns.includes(String(saved.pln)) ? saved.pln : plns.includes("2200") ? 2200 : Number(plns[0]),
    bill: saved.bill ?? 1_000_000, pattern: saved.pattern ?? "seimbang" }
  // Part yang diatur sendiri dipulihkan apa adanya; paket disusun ulang dari harga List Part saat ini.
  if (saved.tier === null && saved.panelId && saved.inverterId) {
    const st = fix(d, { ...base, ...saved, tier: null } as SimpleState)
    if (toConfig(d, st)) return st
  }
  return choosePackage(packagesFor(d, base), base, saved.tier ?? null) ?? { ...base, ...EMPTY }
}

// Mode sederhana (PRD 6.1 sampai 6.5): isi rumah, pilih paket, atau atur part sendiri.
export default function SimpleSimulator({ d }: { d: SimData }) {
  const session = useSession(), navigate = useNavigate()
  const [st, setSt] = useState(() => initial(d))
  const [editing, setEditing] = useState(() => st.tier === null && !!st.panelId)
  const [billText, setBillText] = useState(() => fmtNum(st.bill))
  const [saveError, setSaveError] = useState(""), [busy, setBusy] = useState(false)
  useEffect(() => { saveState(st) }, [st])

  const base: Base = { type: st.type, pln: st.pln, bill: st.bill, pattern: st.pattern }
  const pk = useMemo(() => packagesFor(d, base), [st.type, st.pln, st.bill, st.pattern])
  const config = toConfig(d, st)
  const e = useMemo(() => (config ? evaluate(toParams(config, d.s)) : null), [config?.panel.id, config?.panel_qty, config?.inverter.id, config?.battery?.id,
    config?.battery_qty, st.pln, st.bill, st.pattern])

  // Isian rumah berubah: paket disusun ulang dan paket yang sama dipilih lagi kalau ada (PRD 6.2).
  const setBase = (patch: Partial<Base>) => {
    const next = { ...base, ...patch }
    setSt(choosePackage(packagesFor(d, next), next, st.tier ?? "standar") ?? { ...next, ...EMPTY })
    setEditing(false)
  }
  const choose = (tier: Tier) => { const p = pk.find(x => x.tier === tier); if (p) { setSt(fromPackage(base, p)); setEditing(false) } }
  // Mengubah part lewat Atur sendiri: simulasi tidak lagi tercatat sebagai paket.
  const setPart = (patch: Partial<SimpleState>) => setSt(fix(d, { ...st, ...patch, tier: null }))
  const chosen = pk.find(p => p.tier === st.tier)
  const backTier = pk.find(p => p.tier === "standar")?.tier ?? pk[0]?.tier

  async function save() {
    setBusy(true); setSaveError("")
    try {
      const { simulation } = await api<{ simulation: { id: string } }>("/api/simulations", { body: configBody(config!, st.tier) })
      navigate(`/simulator/${simulation.id}`)
    } catch (err) { setSaveError((err as Error).message); setBusy(false) }
  }

  const input = (
    <>
      <Group title="Jenis sistem" summary={st.type === "hybrid" ? "Hybrid atau off-grid" : "On-grid"}>
        <div className="field full">
          <div className="seg" role="group" aria-label="Jenis sistem">
            <button type="button" aria-pressed={st.type === "hybrid"} onClick={() => setBase({ type: "hybrid" })}>Hybrid / off-grid</button>
            <button type="button" aria-pressed={st.type === "ongrid"} onClick={() => setBase({ type: "ongrid" })}>On-grid</button>
          </div>
          <span className="hint">Hybrid dan off-grid memakai baterai, jadi tetap menyala saat PLN padam. On-grid tanpa baterai: hemat dari listrik yang terpakai
            di siang hari, dan ikut mati saat PLN padam.</span>
        </div>
      </Group>

      <Group title="Rumah Anda" summary={`${fmtNum(st.pln)} VA · tagihan ${rpS(st.bill)}`}>
        <Select label="Daya PLN" value={String(st.pln)} onChange={v => setBase({ pln: Number(v) })}
          options={Object.keys(d.s.tariff_per_va).sort((a, b) => +a - +b).map(v => ({ value: v, label: `${fmtNum(+v)} VA` }))} />
        <Field id="tagihan" label="Tagihan listrik per bulan" pre="Rp" unit="/bln" big full value={billText}
          onValue={v => { setBillText(v); setBase({ bill: Math.max(0, Math.round(parseNum(v))) }) }} />
        <Select label="Pola pemakaian" value={st.pattern} onChange={v => setBase({ pattern: v as SimpleState["pattern"] })}
          options={PATTERNS.map(p => ({ value: p.id, label: p.label }))} hint="Siang = jam 08 sampai 16." />
      </Group>

      {!pk.length ? (
        <section className="card">
          <h2>Paket {st.type === "ongrid" ? "on-grid" : "hybrid"} belum tersedia</h2>
          <p className="sub">Tim kami belum menyiapkan paket untuk jenis sistem ini. Tanya langsung lewat WhatsApp.</p>
          {d.whatsapp
            ? <a className="btn pri" href={waLink(d.whatsapp, `Halo, saya ingin bertanya tentang PLTS ${st.type === "ongrid" ? "on-grid" : "hybrid"}.`)} target="_blank" rel="noreferrer"><FaWhatsapp aria-hidden />Tanya lewat WhatsApp</a>
            : <p className="note">Nomor WhatsApp belum diisi tim.</p>}
        </section>
      ) : (
        <>
          <Group title="Paket" summary={st.tier ? `Paket ${TIER_LABEL[st.tier]}` : "Part diatur sendiri"}>
            <div className="field full">
              <div className="seg" role="group" aria-label="Paket">
                {pk.map(p => <button key={p.tier} type="button" aria-pressed={st.tier === p.tier} onClick={() => choose(p.tier)}>{TIER_LABEL[p.tier]}</button>)}
              </div>
              <span className="hint">Kapasitas panel ketiga paket sama, mengikuti daya PLN rumah. Yang beda merek dan harga part.</span>
            </div>
            {editing && config ? (
              <PartEditor d={d} st={st} config={config} setPart={setPart} back={backTier} onBack={() => choose(backTier)} />
            ) : config && (
              <>
                <PartSummary config={config} pkg={chosen} />
                <button type="button" className="btn sm" onClick={() => setEditing(true)}><LuSlidersHorizontal aria-hidden />Atur sendiri</button>
              </>
            )}
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

  const show = pk.length > 0 && config && e
  return (
    <SimShell title="Simulator PLTS Rumah" sub="Hitung produksi, penghematan, dan balik modal"
      kpi={show ? { saving: e.result.monthly_saving, bep: e.result.bep_years, pvUsed: e.pv_used_pct, invest: e.result.est_investment } : null}
      alerts={show ? layTips(e.params, e.rows).filter(t => t.kind === "bad" || t.kind === "warn").length : 0}
      input={input}
      hasil={show && <><FlowCard sim={e.sim} /><DayCard sim={e.sim} /><CashCard p={e.params} inv={e.result.est_investment} fin={e.fin} /></>}
      opsi={show && <Packages pk={pk} tier={st.tier} onPick={choose} />}
      saran={show && <AdviceCard tips={layTips(e.params, e.rows)} />}
    />
  )
}

// Isi paket terpilih tanpa pilihan, supaya pengunjung tidak perlu memahami angka teknis part (PRD 6.2).
function PartSummary({ config, pkg }: { config: Config; pkg?: Package }) {
  const kwp = (config.panel.wp * config.panel_qty) / 1000
  return (
    <>
      <ul className="part-list">
        <PartRow icon={<TbSolarPanel />} label="Panel" total={rp(config.panel.unit_price * config.panel_qty)}
          select={<p className="part-name">{config.panel_qty} × {config.panel.name}</p>}
          meta={`${fmtNum(config.panel.wp)} Wp per panel · total ${n1(kwp, 2)} kWp`} />
        <PartRow icon={<LuZap />} label="Inverter" total={rp(config.inverter.unit_price)} select={<p className="part-name">{config.inverter.name}</p>}
          meta={`Daya ${fmtNum(config.inverter.rated_w)} W`} />
        {!isOnGrid(config) && <PartRow icon={<LuBatteryCharging />} label="Baterai" total={config.battery ? rp(config.battery.unit_price * config.battery_qty) : undefined}
          select={<p className="part-name">{config.battery ? `${config.battery_qty} × ${config.battery.name}` : "Tanpa baterai"}</p>}
          meta={config.battery && `${fmtNum(config.battery.voltage_v)} V · ${fmtNum(config.battery.capacity_ah)} Ah per unit`} />}
      </ul>
      {pkg?.inverter_too_small
        ? <Why warn>Belum ada inverter di paket ini yang cukup besar untuk daya PLN rumah ini. Silakan hubungi admin.</Why>
        : <Why>Kapasitas panel {n1(kwp, 2)} kWp mengikuti daya PLN rumah Anda.</Why>}
    </>
  )
}

// Atur sendiri (PRD 6.2): panel dan jumlahnya, inverter, serta baterai dan jumlahnya, dimulai dari paket terpilih.
function PartEditor({ d, st, config, setPart, onBack, back }: {
  d: SimData; st: SimpleState; config: Config; setPart: (p: Partial<SimpleState>) => void; onBack: () => void; back: Tier
}) {
  const qtys = arrangements(config.panel, config.inverter), most = Math.max(...qtys.map(a => a.qty))
  const bats = batteriesFor(d, config.inverter), onGrid = isOnGrid(config)
  return (
    <>
      <div className="part-note">
        <span>{st.tier ? `Mulai dari paket ${TIER_LABEL[st.tier]}. Silakan ganti part atau jumlahnya.` : "Part sudah Anda atur sendiri."}</span>
        {!st.tier && <button type="button" className="btn sm" onClick={onBack}><LuRotateCcw aria-hidden />Kembali ke paket {TIER_LABEL[back]}</button>}
      </div>
      <ul className="part-list">
        <PartRow icon={<TbSolarPanel />} label="Panel" total={rp(config.panel.unit_price * config.panel_qty)}
          select={<Choice label="Panel" value={st.panelId} onChange={v => setPart({ panelId: v })}
            options={d.parts.panels.map(p => ({ value: p.id, label: `${p.name} (${rp(p.unit_price)})` }))} />}
          qty={<Choice qty label="Jumlah panel" value={String(config.panel_qty)} onChange={v => setPart({ qty: Number(v) })}
            options={qtys.map(a => ({ value: String(a.qty), label: `${a.qty} panel` }))} />}
          meta={`${fmtNum(config.panel.wp)} Wp per panel · total ${n1((config.panel.wp * config.panel_qty) / 1000, 2)} kWp · ${config.panel_series} seri × ${config.panel_parallel} string`}
          why={most > config.panel_qty && <Why>Inverter ini masih bisa menampung {most - config.panel_qty} panel lagi.</Why>} />
        <PartRow icon={<LuZap />} label="Inverter" total={rp(config.inverter.unit_price)}
          select={<Choice label="Inverter" value={st.inverterId} onChange={v => setPart({ inverterId: v })}
            options={invertersOf(d, systemOf(st)).map(i => ({ value: i.id, label: `${i.name} (${rp(i.unit_price)})` }))} />}
          meta={`Daya ${fmtNum(config.inverter.rated_w)} W${config.inverter.battery_system_v ? ` · sistem baterai ${config.inverter.battery_system_v} V` : ""}`} />
        {!onGrid && <PartRow icon={<LuBatteryCharging />} label="Baterai" total={config.battery ? rp(config.battery.unit_price * config.battery_qty) : undefined}
          select={<Choice label="Baterai" value={st.batteryId ?? ""} onChange={v => setPart({ batteryId: v || null })}
            options={[...bats.map(b => ({ value: b.id, label: `${b.name} (${rp(b.unit_price)})` })), { value: "", label: "Tanpa baterai" }]} />}
          qty={config.battery && <Choice qty label="Jumlah baterai" value={String(st.batteryQty)} onChange={v => setPart({ batteryQty: Number(v) })}
            options={[1, 2, 3, 4].map(n => ({ value: String(n), label: `${n} unit` }))} />}
          meta={config.battery && `${fmtNum(config.battery.voltage_v)} V · ${fmtNum(config.battery.capacity_ah)} Ah per unit`}
          why={!bats.length ? <Why warn>Belum ada baterai yang cocok dengan inverter ini.</Why> : !config.battery && <Why warn>{NO_BATTERY_NOTE}</Why>} />}
      </ul>
    </>
  )
}

// Satu baris part: nama dan subtotal, pilihan, jumlah, angka penting, lalu keterangan.
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

function Summary({ d, config, e }: { d: SimData; config: Config; e: ReturnType<typeof evaluate> }) {
  const inv = investment(config, d.s), onGrid = isOnGrid(config)
  return (
    <section className="card">
      <h2>Ringkasan</h2>
      <dl className="info sum">
        <dt>Kapasitas</dt><dd>{config.panel_qty} × {fmtNum(config.panel.wp)} Wp = {n1(e.result.capacity_kwp, 2)} kWp</dd>
        <dt>Produksi per hari</dt><dd>{n1(e.result.daily_production_kwh)} kWh</dd>
        <dt>Hemat per bulan</dt><dd data-testid="hemat">{rp(e.result.monthly_saving)}</dd>
        <dt>Balik modal</dt><dd>{bepTxt(e.result.bep_years)}</dd>
        <dt>{onGrid ? "Panel dan inverter" : "Panel, inverter, dan baterai"}</dt><dd>{rp(inv.components)}</dd>
        <dt>Aksesoris (perkiraan)</dt><dd>{rp(inv.accessories)}</dd>
        <dt>Jasa (perkiraan)</dt><dd>{rp(inv.service)}</dd>
        <dt>Estimasi investasi</dt><dd>{rp(e.result.est_investment)}</dd>
      </dl>
      <p className="note">{ESTIMATE_LABEL}</p>
      {onGrid && <p className="note">{ONGRID_NOTE}</p>}
    </section>
  )
}

// Perbandingan paket (PRD 6.4): pengganti tabel pembanding lama di mode sederhana.
function Packages({ pk, tier, onPick }: { pk: Package[]; tier: Tier | null; onPick: (t: Tier) => void }) {
  const best = pk.filter(p => p.result.bep_years !== null).sort((a, b) => a.result.bep_years! - b.result.bep_years!)[0]
  return (
    <section className="card">
      <h2>Bandingkan paket</h2>
      <p className="sub">Kapasitas panel sama, tagihan dan pola pemakaian sama. Yang beda merek dan harga part. Hijau = balik modal paling cepat.</p>
      <div className="opts">
        {pk.map(p => (
          <article key={p.tier} className={p === best ? "opt best" : "opt"}>
            <header><h3>{TIER_LABEL[p.tier]}<small>{n1(p.result.capacity_kwp, 2)} kWp · {p.config.panel_qty} panel</small></h3>{p === best && <span className="badge">Tercepat</span>}</header>
            <p className="note">{p.config.inverter.name}{p.config.battery ? ` · ${p.config.battery.name}` : ""}</p>
            <dl>
              <div><dt>Investasi</dt><dd>{rpS(p.result.est_investment)}</dd></div>
              <div><dt>Hemat/bln</dt><dd>{rpS(p.result.monthly_saving)}</dd></div>
              <div><dt>BEP</dt><dd>{bepTxt(p.result.bep_years)}</dd></div>
            </dl>
            {p.tier === tier ? <p className="note"><b>Dipilih</b></p>
              : <button type="button" className="btn sm" onClick={() => onPick(p.tier)}>Pilih {TIER_LABEL[p.tier]}</button>}
          </article>
        ))}
      </div>
    </section>
  )
}
