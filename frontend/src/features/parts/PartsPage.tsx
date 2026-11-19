import { useState, type FormEvent } from "react"
import { fmtNum, rp } from "../../../../shared/format"
import { api } from "../../core/api"
import { Field, Loading, Message, useAction } from "../../core/ui"
import { dateText, useApi } from "../../core/useApi"

type Category = "panel" | "inverter" | "baterai" | "aksesoris"
interface Part { id: string; category: Category; name: string; unit: string; unit_price: number; store_name: string | null; buy_url: string | null; notes: string | null
  is_active: boolean; price_updated_at: string; [k: string]: unknown }
const CATEGORY: Record<Category, string> = { panel: "Panel", inverter: "Inverter", baterai: "Baterai", aksesoris: "Aksesoris" }
// Kolom teknis per kategori (PRD 11.1). Wajib untuk Panel, Inverter, dan Baterai karena Simulator menghitung dari angka itu.
const TECH: Record<Category, [string, string][]> = {
  panel: [["wp", "Daya (Wp)"], ["voc", "Voc (V)"], ["vmp", "Vmp (V)"]],
  inverter: [["rated_w", "Daya (W)"], ["pv_max_w", "Batas daya PV (W)"], ["pv_voc_max", "Batas Voc PV (V)"], ["mppt_v_min", "MPPT minimal (V)"],
    ["mppt_v_max", "MPPT maksimal (V)"], ["efficiency_pct", "Efisiensi (%)"]],
  baterai: [["capacity_ah", "Kapasitas (Ah)"], ["voltage_v", "Tegangan nominal (V)"], ["dod_pct", "Kedalaman pakai (% DoD)"]],
  aksesoris: [],
}
const STALE = 30 * 86400e3

// List Part (PRD bagian 11): satu-satunya sumber part dan harga untuk Simulator dan Planning. Part tidak dihapus, hanya dinonaktifkan.
export default function PartsPage() {
  const [category, setCategory] = useState(""), [active, setActive] = useState("true"), [editing, setEditing] = useState<Part | "baru" | null>(null)
  const list = useApi<{ parts: Part[] }>(`/api/admin/parts?category=${category}&active=${active}`)
  return (
    <section className="wrap page">
      <div className="head">
        <h1>List Part</h1>
        <button type="button" className="btn pri" onClick={() => setEditing("baru")}>Tambah part</button>
      </div>
      {editing && <PartForm part={editing === "baru" ? null : editing} onDone={() => { setEditing(null); list.reload() }} />}
      <div className="card">
        <div className="filters">
          <label>Kategori <select value={category} onChange={e => setCategory(e.target.value)}><option value="">Semua</option>
            {Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Status <select value={active} onChange={e => setActive(e.target.value)}>
            <option value="true">Aktif</option><option value="false">Nonaktif</option><option value="">Semua</option></select></label>
        </div>
        {!list.data ? <Loading /> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Nama</th><th>Kategori</th><th className="num">Harga satuan</th><th>Harga diperbarui</th><th>Toko</th><th /></tr></thead>
            <tbody>{list.data.parts.map(p => (
              <tr key={p.id} className={p.is_active ? "" : "off"}>
                <td>{p.name}{!p.is_active && <small>Nonaktif</small>}</td>
                <td>{CATEGORY[p.category]}<small>{TECH[p.category].map(([k]) => p[k] != null ? fmtNum(p[k] as number) : "").filter(Boolean).join(" · ")}</small></td>
                <td className="num">{rp(p.unit_price)}<small>per {p.unit}</small></td>
                <td className={Date.now() - Date.parse(p.price_updated_at) > STALE ? "bad" : ""}>{dateText(p.price_updated_at)}</td>
                <td>{p.buy_url ? <a href={p.buy_url} target="_blank" rel="noreferrer">{p.store_name ?? "Link beli"}</a> : p.store_name ?? "-"}</td>
                <td><button type="button" className="btn sm" onClick={() => setEditing(p)}>Ubah</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </section>
  )
}

function PartForm({ part, onDone }: { part: Part | null; onDone: () => void }) {
  const [category, setCategory] = useState<Category>(part?.category ?? "panel")
  const [systemType, setSystemType] = useState(String(part?.system_type ?? "hybrid_offgrid"))
  const act = useAction()
  const numOr = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v))
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const body: Record<string, unknown> = { name: f.get("name"), unit: f.get("unit"), unit_price: Number(f.get("unit_price")), store_name: f.get("store_name") || null,
      buy_url: f.get("buy_url") || null, notes: f.get("notes") || null, is_active: f.get("is_active") === "on",
      ...Object.fromEntries(TECH[category].map(([k]) => [k, numOr(f.get(k))])) }
    if (category === "inverter") { body.system_type = systemType; body.battery_system_v = systemType === "on_grid" ? null : numOr(f.get("battery_system_v")) }
    if (category === "baterai") body.battery_system_v = numOr(f.get("battery_system_v"))
    act.run(async () => {
      if (part) await api(`/api/admin/parts/${part.id}`, { method: "PATCH", body })
      else await api("/api/admin/parts", { body: { ...body, category } })
      onDone()
    })
  }
  return (
    <form className="card form" onSubmit={save}>
      <h2>{part ? `Ubah ${part.name}` : "Tambah part"}</h2>
      <div className="fields">
        <div className="field"><label htmlFor="part-cat">Kategori</label><div className="box">
          <select id="part-cat" value={category} disabled={!!part} onChange={e => setCategory(e.target.value as Category)}>
            {Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          {part && <span className="hint">Kategori tidak bisa diganti.</span>}</div>
        <Field label="Nama" name="name" defaultValue={part?.name} required />
        <Field label="Satuan" name="unit" defaultValue={part?.unit ?? "unit"} required />
        <Field label="Harga satuan" name="unit_price" type="number" min="0" defaultValue={part?.unit_price} required hint="Harga satuan di toko, sebelum voucher dan ongkir." />
        <Field label="Toko" name="store_name" defaultValue={part?.store_name ?? ""} />
        <Field label="Link beli" name="buy_url" type="url" defaultValue={part?.buy_url ?? ""} />
        {category === "inverter" && <div className="field"><label htmlFor="sys-type">Jenis sistem</label><div className="box">
          <select id="sys-type" value={systemType} onChange={e => setSystemType(e.target.value)}><option value="hybrid_offgrid">Hybrid atau off-grid</option><option value="on_grid">On-grid</option></select></div></div>}
        {(category === "baterai" || (category === "inverter" && systemType !== "on_grid")) && (
          <div className="field"><label htmlFor="bat-v">Kelas tegangan baterai (V)</label><div className="box">
            <select id="bat-v" name="battery_system_v" defaultValue={String(part?.battery_system_v ?? 24)}>{[12, 24, 48].map(v => <option key={v} value={v}>{v} V</option>)}</select></div></div>
        )}
        {TECH[category].map(([k, l]) => <Field key={`${category}-${k}`} label={l} name={k} type="number" step="any" min="0" defaultValue={(part?.[k] as number | undefined) ?? ""} required />)}
      </div>
      <div className="field"><label htmlFor="part-notes">Catatan</label><textarea id="part-notes" name="notes" rows={2} defaultValue={part?.notes ?? ""} /></div>
      <label className="check"><input type="checkbox" name="is_active" defaultChecked={part?.is_active ?? true} /> Aktif (muncul di pilihan Simulator dan Planning)</label>
      <Message msg={act.msg} />
      <div className="actions"><button className="btn pri" disabled={act.busy}>Simpan</button><button type="button" className="btn" onClick={onDone}>Batal</button></div>
    </form>
  )
}
