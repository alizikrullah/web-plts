import { useLayoutEffect, useRef, type ReactNode } from "react"
import type { Params, Sim } from "../../../../shared/calc/rumah"
import { fmtNum, liveFormat, n1, parseNum, rp, rpS } from "../../../../shared/format"
import { LuChevronDown, LuMinus, LuPlus } from "react-icons/lu"

export type Form = Record<keyof Params, string>
type NumKey = Exclude<keyof Params, "mode">

interface Props { form: Form; set: (k: keyof Params, v: string) => void; p: Params; sim: Sim; inv: number }

export function Inputs({ form, set, p, sim, inv }: Props) {
  const f = (k: NumKey) => ({ id: k, value: form[k], onValue: (v: string) => set(k, v) })
  const panels = p.seri * p.paralel
  return (
    <>
      <Group title="Tarif & tagihan" summary={`${rp(p.tarif)}/kWh · tagihan ${rpS(p.tagihan)}`}>
        <Field {...f("tarif")} label="Tarif listrik" pre="Rp" unit="/kWh" big />
        <Field {...f("tagihan")} label="Tagihan saat ini" pre="Rp" unit="/bln" big />
        <Field {...f("esc")} label="Kenaikan tarif" unit="%/th" />
        <Info label="Pemakaian dari tagihan" value={p.tarif > 0 ? `${n1(p.tagihan / p.tarif / 30, 1)} kWh/hari` : "-"} />
      </Group>

      <Group title="Panel surya" summary={`${panels} × ${fmtNum(p.wp)} Wp · ${n1(sim.wpTot / 1000, 2)} kWp`}>
        <Field {...f("wp")} label="Daya per panel" unit="Wp" big />
        <Field {...f("psh")} label="Jam matahari efektif" unit="jam" hint="per hari (PSH)" />
        <Field {...f("seri")} label="Panel seri" hint="per string" step />
        <Field {...f("paralel")} label="String paralel" hint="jumlah string" step />
        <Info full label="Total panel & kapasitas" value={`${panels} panel · ${fmtNum(panels * p.wp)} Wp (${n1(panels * p.wp / 1000, 2)} kWp)`} />
        <Field {...f("voc")} label="Voc panel" unit="V" />
        <Field {...f("vmp")} label="Vmp panel" unit="V" />
        <Field {...f("loss")} label="Rugi-rugi sistem" unit="%" hint="suhu, kabel, debu" />
        <Field {...f("deg")} label="Degradasi panel" unit="%/th" />
      </Group>

      <Group title="Inverter & baterai" summary={`${p.ah > 0 ? `${fmtNum(p.ah)} Ah ${fmtNum(p.bv)} V` : "Tanpa baterai"} · mode ${p.mode}`}>
        <Field {...f("pvMax")} label="Batas daya PV" unit="W" hint="ILS3800: 2.700" big />
        <Field {...f("vocMax")} label="Batas Voc PV" unit="V" hint="ILS3800: 245" />
        <Field {...f("invRated")} label="Daya inverter" unit="W" big />
        <Field {...f("invEff")} label="Efisiensi inverter" unit="%" />
        <Field {...f("ah")} label="Kapasitas baterai" unit="Ah" hint="0 = tanpa baterai" big />
        <Field {...f("bv")} label="Tegangan baterai" unit="V" hint="LiFePO4 8S: 25,6" />
        <Field {...f("dod")} label="Kedalaman pakai" unit="% DoD" />
        <div className="field">
          <span className="lbl">Mode kerja</span>
          <div className="seg" role="group" aria-label="Mode kerja">
            {(["SBU", "SOL"] as const).map(m => (
              <button key={m} type="button" aria-pressed={form.mode === m} onClick={() => set("mode", m)}>{m}</button>
            ))}
          </div>
          <span className="hint">SBU: baterai juga malam. SOL: siang saja (setting 02).</span>
        </div>
        <Field {...f("unlock")} full label="SOC baterai sebelum lepas dari PLN" unit="%"
          hint="Setelah baterai habis, beban di PLN sampai baterai terisi kembali ke nilai ini (mirip setting ATD)." />
      </Group>

      <Group title="Beban di AC OUT" summary={`Siang ${fmtNum(p.pDay)} kW · malam ${fmtNum(p.pNight)} kW`}>
        <Field {...f("pDay")} label="Beban siang" unit="kW" hint="rata-rata" />
        <Field {...f("pNight")} label="Beban malam/pagi" unit="kW" hint="rata-rata" />
        <Field {...f("hStart")} label="Siang mulai" unit="jam" />
        <Field {...f("hEnd")} label="Siang selesai" unit="jam" />
        <Info full label="Total beban AC OUT" value={`${n1(sim.loadE)} kWh/hari`} />
      </Group>

      <Group title="Biaya investasi" summary={`Total ${rpS(inv)}`}>
        <Field {...f("cPanel")} label="Harga per panel" pre="Rp" big />
        <Field {...f("cInv")} label="Inverter" pre="Rp" big />
        <Field {...f("cBat")} label="Baterai + BMS" pre="Rp" big />
        <Field {...f("cEtc")} label="Instalasi & lain-lain" pre="Rp" hint="rangka, kabel, MCB" big />
        <Field {...f("yInv")} label="Ganti inverter tahun ke" hint="0 = tidak dihitung" />
        <Field {...f("yBat")} label="Ganti baterai tahun ke" hint="0 = tidak dihitung" />
        <Field {...f("years")} label="Umur analisis" unit="tahun" />
        <Info label="Total investasi" value={rp(inv)} />
      </Group>
    </>
  )
}

export function Group({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <details className="group" open>
      <summary>
        <span className="t"><b>{title}</b><span>{summary}</span></span>
        <LuChevronDown aria-hidden />
      </summary>
      <div className="fields">{children}</div>
    </details>
  )
}

interface FieldProps {
  id: string; value: string; onValue: (v: string) => void; label: string
  pre?: string; unit?: string; hint?: string
  big?: boolean   // nilai ribuan: titik yang diketik = pemisah ribuan, bukan desimal
  full?: boolean; step?: boolean
}

export function Field({ id, value, onValue, label, pre, unit, hint, big, full, step }: FieldProps) {
  const ref = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caret.current === null) return
    ref.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })
  const bump = (d: number) => onValue(fmtNum(Math.max(1, Math.round(parseNum(value)) + d)))
  return (
    <div className={full ? "field full" : "field"}>
      <label htmlFor={id}>{label}</label>
      <div className={step ? "box step" : "box"}>
        {step && <button type="button" aria-label={`Kurangi ${label.toLowerCase()}`} onClick={() => bump(-1)}><LuMinus aria-hidden /></button>}
        {pre && <span className="u">{pre}</span>}
        <input
          ref={ref} id={id} value={value} type="text" inputMode="decimal" autoComplete="off"
          aria-describedby={hint ? `${id}-h` : undefined}
          onChange={e => {
            const el = e.target, r = liveFormat(el.value, el.selectionStart ?? el.value.length, !big)
            caret.current = r.caret
            onValue(r.value)
          }}
          onBlur={() => onValue(fmtNum(parseNum(value)))}
        />
        {unit && <span className="u">{unit}</span>}
        {step && <button type="button" aria-label={`Tambah ${label.toLowerCase()}`} onClick={() => bump(1)}><LuPlus aria-hidden /></button>}
      </div>
      {hint && <span className="hint" id={`${id}-h`}>{hint}</span>}
    </div>
  )
}

export function Info({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "field full" : "field"}>
      <span className="lbl">{label}</span>
      <div className="box info">{value}</div>
    </div>
  )
}
