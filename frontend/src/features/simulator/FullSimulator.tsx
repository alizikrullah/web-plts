import { useMemo, useState } from "react"
import { DEF, type Params } from "../../../../shared/calc/rumah"
import { evaluate, investment, toParams, type Battery, type Inverter, type Panel } from "../../../../shared/calc/simulator"
import { fmtNum, parseNum } from "../../../../shared/format"
import { Inputs, Group, type Form } from "./Inputs"
import { AdviceCard, CashCard, DayCard, FlowCard, Options } from "./Results"
import { batteriesFor, hybridInverters, recommended, toConfig, type SimData } from "./simple"
import { Select, SimShell } from "./SimulatorPage"

const keys = Object.keys(DEF) as (keyof Params)[]
const toForm = (p: Partial<Params>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, k === "mode" ? v : fmtNum(v as number)])) as Partial<Form>
function toParamsOf(f: Form) {
  const p = Object.fromEntries(keys.map(k => [k, k === "mode" ? f.mode : parseNum(f[k])])) as unknown as Params
  p.seri = Math.max(1, Math.round(p.seri)); p.paralel = Math.max(1, Math.round(p.paralel))
  return p
}

// Angka teknis, harga, dan tarif yang terisi otomatis dari part terpilih (PRD 6.1: bisa ditimpa admin).
function partFields(panel: Panel, inv: Inverter, bat: Battery | null, batQty: number, tarif: number): Partial<Params> {
  return { wp: panel.wp, voc: panel.voc, vmp: panel.vmp, cPanel: panel.unit_price, pvMax: inv.pv_max_w, vocMax: inv.pv_voc_max,
    invRated: inv.rated_w, invEff: inv.efficiency_pct, cInv: inv.unit_price, ah: bat ? bat.capacity_ah * batQty : 0, bv: bat?.voltage_v ?? 0,
    dod: bat?.dod_pct ?? 0, cBat: bat ? bat.unit_price * batQty : 0, tarif }
}

// Mode lengkap untuk admin (PRD 6.1): semua isian simulator HTML, part dari List Part, dan nilai bawaan yang bisa diubah.
export default function FullSimulator({ d }: { d: SimData }) {
  const start = recommended(d, { type: "hybrid", pln: 2200, bill: 1_000_000, pattern: "seimbang" })
  const [sel, setSel] = useState({ pln: 2200, panelId: start?.panelId ?? "", inverterId: start?.inverterId ?? "", batteryId: start?.batteryId ?? "", batteryQty: start?.batteryQty || 1 })
  const [form, setForm] = useState<Form>(() => ({ ...toForm(DEF), ...(start ? toForm(toParams(toConfig(d, start)!, d.s)) : {}) }) as Form)
  const p = useMemo(() => toParamsOf(form), [form])
  const e = useMemo(() => evaluate(p), [p])

  const panel = d.parts.panels.find(x => x.id === sel.panelId), inverter = d.parts.inverters.find(x => x.id === sel.inverterId)
  const bats = batteriesFor(d, inverter), battery = bats.find(b => b.id === sel.batteryId) ?? null
  function choose(patch: Partial<typeof sel>) {
    const next = { ...sel, ...patch }
    const pa = d.parts.panels.find(x => x.id === next.panelId), inv = d.parts.inverters.find(x => x.id === next.inverterId)
    if (!pa || !inv) return setSel(next)
    const bat = batteriesFor(d, inv).find(b => b.id === next.batteryId) ?? null
    setSel({ ...next, batteryId: bat?.id ?? "" })
    const etc = investment(pa, p.seri * p.paralel, inv, bat, next.batteryQty, d.s)
    setForm(f => ({ ...f, ...toForm({ ...partFields(pa, inv, bat, next.batteryQty, d.s.tariff_per_va[String(next.pln)]), cEtc: etc.accessories + etc.installation }) }))
  }
  const inv = panel && inverter ? investment(panel, p.seri * p.paralel, inverter, battery, sel.batteryQty, d.s) : null

  const input = (
    <>
      <Group title="Part dari List Part" summary="Angka teknis dan harga terisi otomatis, bisa ditimpa di bawah">
        <Select label="Daya PLN" value={String(sel.pln)} onChange={v => choose({ pln: Number(v) })}
          options={Object.keys(d.s.tariff_per_va).sort((a, b) => +a - +b).map(v => ({ value: v, label: `${fmtNum(+v)} VA (tarif per kWh)` }))} />
        <Select label="Panel" value={sel.panelId} onChange={v => choose({ panelId: v })} options={d.parts.panels.map(x => ({ value: x.id, label: x.name }))} />
        <Select label="Inverter" value={sel.inverterId} onChange={v => choose({ inverterId: v })} options={hybridInverters(d).map(x => ({ value: x.id, label: x.name }))} />
        <Select label="Baterai" value={sel.batteryId} onChange={v => choose({ batteryId: v })}
          options={[...bats.map(b => ({ value: b.id, label: b.name })), { value: "", label: "Tanpa baterai" }]} />
        {sel.batteryId && <Select label="Jumlah baterai" value={String(sel.batteryQty)} onChange={v => choose({ batteryQty: Number(v) })}
          options={[1, 2, 3, 4].map(n => ({ value: String(n), label: `${n} unit` }))} />}
        {inv && <p className="hint field full">Estimasi aksesoris {fmtNum(d.s.accessories_estimate_pct)}% dan jasa instalasi dari Pengaturan: Rp{fmtNum(inv.accessories + inv.installation)}
          (isian "Instalasi & lain-lain"). Hasil mode lengkap tidak disimpan.</p>}
      </Group>
      <Inputs form={form} set={(k, v) => setForm(f => ({ ...f, [k]: v }))} p={p} sim={e.sim} inv={e.result.est_investment} />
    </>
  )
  return (
    <SimShell title="Simulator mode lengkap" sub="Semua isian simulator HTML, khusus admin"
      kpi={{ saving: e.result.monthly_saving, bep: e.result.bep_years, pvUsed: e.pv_used_pct, invest: e.result.est_investment }}
      alerts={e.tips.filter(t => t.kind === "bad" || t.kind === "warn").length}
      input={input}
      hasil={<><FlowCard sim={e.sim} /><DayCard sim={e.sim} /><CashCard p={p} inv={e.result.est_investment} fin={e.fin} /></>}
      opsi={<Options rows={e.rows} best={e.best} />}
      saran={<AdviceCard tips={e.tips} />}
    />
  )
}
