import { useEffect, useState, type ReactNode } from "react"
import type { Battery, Inverter, Panel, SimSettings } from "../../../../shared/calc/simulator"
import { bepTxt, n1, rpS } from "../../../../shared/format"
import { api } from "../../core/api"
import { LuChartLine, LuColumns2, LuLightbulb, LuSlidersHorizontal, LuSun } from "react-icons/lu"
import { useSession } from "../../core/session"
import { Loading } from "../../core/ui"
import FullSimulator from "./FullSimulator"
import type { SimData } from "./simple"
import SimpleSimulator from "./SimpleSimulator"

// Simulator (PRD bagian 6): mode sederhana untuk pengunjung, guest, dan client; mode lengkap untuk admin.
// Part dan nilai bawaan diambil dari List Part dan Pengaturan, lalu dihitung dengan modul yang sama dengan backend.
export default function SimulatorPage() {
  const session = useSession()
  const [data, setData] = useState<SimData | null>(null), [error, setError] = useState("")
  useEffect(() => {
    Promise.all([api<{ parts: any[] }>("/api/parts"), api<{ settings: Record<string, any> }>("/api/settings/public")]).then(([p, { settings }]) => {
      const of = <T,>(c: string) => p.parts.filter(x => x.category === c) as T[]
      setData({
        parts: { panels: of<Panel>("panel"), inverters: of<Inverter>("inverter"), batteries: of<Battery>("baterai") },
        s: { ...settings, installation_estimate: settings.installation_estimate ?? 0 } as SimSettings,
        whatsapp: settings.whatsapp_number ?? null, installationMissing: settings.installation_estimate == null,
      })
    }).catch(e => setError(e.message))
  }, [])
  if (error) return <section className="wrap page"><p className="msg bad" role="alert">{error}</p></section>
  if (!data || session.status === "loading") return <Loading />
  return session.status === "user" && session.user.role === "admin" ? <FullSimulator d={data} /> : <SimpleSimulator d={data} />
}

const TABS = [
  { id: "input", label: "Input", icon: LuSlidersHorizontal }, { id: "hasil", label: "Hasil", icon: LuChartLine },
  { id: "opsi", label: "Opsi", icon: LuColumns2 }, { id: "saran", label: "Saran", icon: LuLightbulb },
] as const
type Tab = (typeof TABS)[number]["id"]
export interface Kpi { saving: number; bep: number | null; pvUsed: number; invest: number }

// Tampilan simulator dari HTML lama: ringkasan menempel di atas, di HP satu bagian per tab, di layar lebar dua kolom.
export function SimShell({ title, sub, kpi, alerts, input, hasil, opsi, saran }: {
  title: string; sub: string; kpi: Kpi | null; alerts: number; input: ReactNode; hasil?: ReactNode; opsi?: ReactNode; saran?: ReactNode
}) {
  const [tab, setTab] = useState<Tab>(() => TABS.find(t => location.hash === "#" + t.id)?.id ?? "input")
  const go = (t: Tab) => { setTab(t); history.replaceState(history.state, "", "#" + t); window.scrollTo(0, 0) }
  const panel = (t: Tab) => (tab === t || !kpi ? "panel on" : "panel")
  return (
    <>
      <header className="appbar">
        <div className="wrap"><LuSun aria-hidden /><div><h1>{title}</h1><p>{sub}</p></div></div>
      </header>
      {kpi && (
        <div className="kpis" aria-live="polite">
          <div className="wrap">
            <div className="kpi"><small>Hemat/bulan</small><b className="hi">{rpS(kpi.saving)}</b></div>
            <div className="kpi"><small>Balik modal</small><b>{bepTxt(kpi.bep)}</b></div>
            <div className="kpi"><small>PV terpakai</small><b>{n1(Math.min(100, kpi.pvUsed), 0)}%</b></div>
            <div className="kpi"><small>Investasi</small><b>{rpS(kpi.invest)}</b></div>
          </div>
        </div>
      )}
      <div className="wrap layout">
        <div className={panel("input")}>{input}</div>
        {kpi && (
          <div className="results">
            <div className={panel("hasil")}>{hasil}</div>
            <div className={panel("opsi")}>{opsi}</div>
            <div className={panel("saran")}>{saran}</div>
          </div>
        )}
      </div>
      {kpi && (
        <nav className="tabbar" aria-label="Bagian">
          {TABS.map(t => (
            <button key={t.id} type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
              <t.icon aria-hidden /><span>{t.label}</span>
              {t.id === "saran" && alerts > 0 && <span className="count">{alerts}</span>}
            </button>
          ))}
        </nav>
      )}
    </>
  )
}

export function Select({ label, value, onChange, options, hint }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: string
}) {
  const id = "sel-" + label.toLowerCase().replace(/\W+/g, "-")
  return (
    <div className="field full">
      <label htmlFor={id}>{label}</label>
      <div className="box"><select id={id} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select></div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}
