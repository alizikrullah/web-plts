import { useMemo, useState } from "react"
import { DEF, type Params } from "../../../../shared/calc/rumah"
import { arrangement, evaluate, toParams, type Config } from "../../../../shared/calc/simulator"
import { fmtNum, parseNum } from "../../../../shared/format"
import { Inputs, Group, type Form } from "./Inputs"
import { AdviceCard, CashCard, DayCard, FlowCard, Options } from "./Results"
import { batteriesFor, choosePackage, packagesFor, toConfig, type Base, type SimData } from "./simple"
import { Select, SimShell } from "./SimulatorPage"

const keys = Object.keys(DEF) as (keyof Params)[]
const toForm = (p: Partial<Params>) => Object.fromEntries(keys.filter(k => k in p).map(k => [k, k === "mode" ? p[k] : fmtNum(p[k] as number)])) as Partial<Form>
function toParamsOf(f: Form) {
  const p = Object.fromEntries(keys.map(k => [k, k === "mode" ? f.mode : parseNum(f[k])])) as unknown as Params
  p.seri = Math.max(1, Math.round(p.seri)); p.paralel = Math.max(1, Math.round(p.paralel))
  return p
}
// Angka dari part yang tidak ada di isian simulator HTML: batas MPPT, arus, dan penanda on-grid (PRD 6.1).
const extraOf = (p: Params): Partial<Params> => ({ mpptMin: p.mpptMin, mpptMax: p.mpptMax, isc: p.isc, iMax: p.iMax, onGrid: p.onGrid })
// Isian yang terisi otomatis dari part terpilih (PRD 6.1: bisa ditimpa admin), termasuk aksesoris, jasa, dan umur baterai (PRD 6.3).
const FROM_PARTS: (keyof Params)[] = ["wp", "voc", "vmp", "cPanel", "pvMax", "vocMax", "invRated", "invEff", "cInv", "ah", "bv", "dod", "cBat", "tarif", "cEtc", "yBat"]
const pickParts = (p: Params) => Object.fromEntries(FROM_PARTS.map(k => [k, p[k]])) as Partial<Params>

// Mode lengkap untuk admin (PRD 6.1): semua isian simulator HTML, part dari List Part, dan nilai bawaan yang bisa diubah.
export default function FullSimulator({ d }: { d: SimData }) {
  const base: Base = { type: "hybrid", pln: 2200, bill: 1_000_000, pattern: "seimbang" }
  const start = choosePackage(packagesFor(d, base), base, "standar")
  const startConfig = start && toConfig(d, start)
  const [sel, setSel] = useState({ pln: 2200, panelId: start?.panelId ?? d.parts.panels[0]?.id ?? "", inverterId: start?.inverterId ?? d.parts.inverters[0]?.id ?? "",
    batteryId: start?.batteryId ?? "", batteryQty: start?.batteryQty || 1 })
  const [form, setForm] = useState<Form>(() => ({ ...toForm(DEF), ...(startConfig ? toForm(toParams(startConfig, d.s)) : {}) }) as Form)
  const [extra, setExtra] = useState<Partial<Params>>(() => (startConfig ? extraOf(toParams(startConfig, d.s)) : {}))
  const p = useMemo(() => ({ ...extra, ...toParamsOf(form) }), [form, extra])
  const e = useMemo(() => evaluate(p), [p])

  const inverter = d.parts.inverters.find(x => x.id === sel.inverterId)
  const bats = batteriesFor(d, inverter)
  const [etc, setEtc] = useState(() => (startConfig ? toParams(startConfig, d.s).cEtc : 0))
  function choose(patch: Partial<typeof sel>) {
    const next = { ...sel, ...patch }
    const pa = d.parts.panels.find(x => x.id === next.panelId), inv = d.parts.inverters.find(x => x.id === next.inverterId)
    if (!pa || !inv) return setSel(next)
    const bat = batteriesFor(d, inv).find(b => b.id === next.batteryId) ?? null
    setSel({ ...next, batteryId: bat?.id ?? "" })
    // Susunan seri dan paralel dari isian tetap dipakai; kalau tidak valid untuk part baru, dihitung ulang dari jumlah panelnya.
    const qty = p.seri * p.paralel, a = arrangement(pa, inv, qty)
    const c: Config = { pln_power_va: next.pln, monthly_bill: p.tagihan, usage_pattern: "seimbang", panel: pa, panel_qty: qty,
      panel_series: a?.series ?? p.seri, panel_parallel: a?.parallel ?? p.paralel, inverter: inv, battery: bat, battery_qty: bat ? next.batteryQty : 0,
      accessories: d.parts.accessories }
    const q = toParams(c, d.s)
    setForm(f => ({ ...f, ...toForm(pickParts(q)) }))
    setExtra(extraOf(q)); setEtc(q.cEtc)
  }

  const input = (
    <>
      <Group title="Part dari List Part" summary="Angka teknis dan harga terisi otomatis, bisa ditimpa di bawah">
        <Select label="Daya PLN" value={String(sel.pln)} onChange={v => choose({ pln: Number(v) })}
          options={Object.keys(d.s.tariff_per_va).sort((a, b) => +a - +b).map(v => ({ value: v, label: `${fmtNum(+v)} VA (tarif per kWh)` }))} />
        <Select label="Panel" value={sel.panelId} onChange={v => choose({ panelId: v })} options={d.parts.panels.map(x => ({ value: x.id, label: x.name }))} />
        <Select label="Inverter" value={sel.inverterId} onChange={v => choose({ inverterId: v })}
          options={d.parts.inverters.map(x => ({ value: x.id, label: x.system_type === "on_grid" ? `${x.name} (on-grid)` : x.name }))} />
        {inverter?.system_type !== "on_grid" && <Select label="Baterai" value={sel.batteryId} onChange={v => choose({ batteryId: v })}
          options={[...bats.map(b => ({ value: b.id, label: b.name })), { value: "", label: "Tanpa baterai" }]} />}
        {sel.batteryId && inverter?.system_type !== "on_grid" && <Select label="Jumlah baterai" value={String(sel.batteryQty)} onChange={v => choose({ batteryQty: Number(v) })}
          options={[1, 2, 3, 4].map(n => ({ value: String(n), label: `${n} unit` }))} />}
        <p className="hint field full">Estimasi aksesoris dan jasa dari List Part dan Pengaturan: Rp{fmtNum(etc)} (isian "Instalasi & lain-lain"). Tahun ganti baterai
          dihitung dari jumlah siklus baterai. Hasil mode lengkap tidak disimpan.</p>
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
