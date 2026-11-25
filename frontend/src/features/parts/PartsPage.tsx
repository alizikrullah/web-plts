import { useState, type FormEvent } from "react"
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { fmtNum, rp } from "../../../../shared/format"
import { api } from "../../core/api"
import { Field, Loading, Message, useAction } from "../../core/ui"
import { dateText, useApi } from "../../core/useApi"

type Category = "panel" | "inverter" | "baterai" | "aksesoris"
interface Part { id: string; category: Category; name: string; unit: string; unit_price: number; store_name: string | null; buy_url: string | null; notes: string | null
  is_active: boolean; price_updated_at: string; [k: string]: unknown }
const CATEGORY: Record<Category, string> = { panel: "Panel", inverter: "Inverter", baterai: "Baterai", aksesoris: "Aksesoris" }
// Kolom teknis per kategori (PRD 11.1). Wajib untuk Panel, Inverter, dan Baterai karena Simulator menghitung dari angka itu,
// kecuali yang ditandai boleh kosong.
const TECH: Record<Category, [string, string][]> = {
  panel: [["wp", "Daya (Wp)"], ["voc", "Voc (V)"], ["vmp", "Vmp (V)"]],
  inverter: [["rated_w", "Daya (W)"], ["pv_max_w", "Batas daya PV (W)"], ["pv_voc_max", "Batas Voc PV (V)"], ["mppt_v_min", "MPPT minimal (V)"],
    ["mppt_v_max", "MPPT maksimal (V)"], ["efficiency_pct", "Efisiensi (%)"]],
  baterai: [["capacity_ah", "Kapasitas (Ah)"], ["voltage_v", "Tegangan nominal (V)"], ["dod_pct", "Kedalaman pakai (% DoD)"]],
  aksesoris: [],
}
const OPTIONAL: Record<Category, [string, string, string][]> = {
  panel: [["isc", "Isc (A)", "Boleh kosong. Tanpa Isc, cek arus di Simulator dilewati."]],
  inverter: [["pv_current_max", "Arus input PV maksimal (A)", "Total semua input MPPT. Boleh kosong, cek arus dilewati."]],
  baterai: [["cycle_life", "Jumlah siklus (datasheet)", "Boleh kosong. Umur baterai lalu memakai umur maksimal di Pengaturan."]],
  aksesoris: [],
}
const TIER: Record<string, string> = { hemat: "Hemat", standar: "Standar", premium: "Premium" }
const BASIS: Record<string, string> = { per_sistem: "per sistem", per_string: "per string", per_panel: "per panel" }
const STALE = 30 * 86400e3
const INVERTER_TYPE: Record<string, string> = { hybrid_offgrid: "Hybrid atau off-grid", on_grid: "On-grid" }
// Filter kategori: inverter dipecah per jenis sistem.
const FILTERS: [string, string][] = [["panel", "Panel"], ["inverter", "Inverter (semua)"], ["inverter:hybrid_offgrid", "Inverter hybrid atau off-grid"],
  ["inverter:on_grid", "Inverter on-grid"], ["baterai", "Baterai"], ["aksesoris", "Aksesoris"]]

// Spesifikasi singkat dengan nama dan satuan, supaya bisa dicek sekilas tanpa membuka halaman ubah.
function specOf(p: Part) {
  const n = (k: string) => fmtNum(p[k] as number), has = (k: string) => p[k] != null
  const out: string[] = []
  if (p.category === "panel") out.push(`${n("wp")} Wp`, `Voc ${n("voc")} V`, `Vmp ${n("vmp")} V`, ...(has("isc") ? [`Isc ${n("isc")} A`] : []))
  if (p.category === "inverter") out.push(`${n("rated_w")} W`, `PV maks ${n("pv_max_w")} W`, `Voc maks ${n("pv_voc_max")} V`, `MPPT ${n("mppt_v_min")} sampai ${n("mppt_v_max")} V`,
    ...(has("pv_current_max") ? [`arus maks ${n("pv_current_max")} A`] : []), `efisiensi ${n("efficiency_pct")}%`, ...(has("battery_system_v") ? [`baterai ${n("battery_system_v")} V`] : []))
  if (p.category === "baterai") out.push(`${n("capacity_ah")} Ah`, `${n("voltage_v")} V (kelas ${n("battery_system_v")} V)`, `DoD ${n("dod_pct")}%`,
    ...(has("cycle_life") ? [`${n("cycle_life")} siklus`] : []))
  if (p.category === "aksesoris" && p.qty_basis)
    out.push(`Simulator: ${n("qty_per_basis")} ${p.unit} ${BASIS[p.qty_basis as string]}`)
  return out.join(" · ")
}

// List Part (PRD bagian 11): satu-satunya sumber part dan harga untuk Simulator dan Planning. Part tidak dihapus, hanya dinonaktifkan.
// Tambah dan ubah part ada di halaman sendiri (/list-part/baru dan /list-part/:id/ubah). Filter disimpan di alamat supaya tetap sama saat kembali.
export default function PartsPage() {
  const [sp, setSp] = useSearchParams(), location = useLocation()
  const kind = sp.get("kategori") ?? "", active = sp.get("status") ?? "true"
  const [category, system] = kind.split(":")
  const filter = (k: string, v: string) => setSp(s => { s.set(k, v); return s }, { replace: true })
  const list = useApi<{ parts: Part[] }>(`/api/admin/parts?category=${category}&active=${active}`)
  const parts = list.data?.parts.filter(p => !system || p.system_type === system)
  const saved = (location.state as { saved?: string } | null)?.saved
  const back = { back: location.search }
  return (
    <section className="wrap page">
      <div className="head">
        <h1>List Part</h1>
        <Link className="btn pri" to="/list-part/baru" state={back}>Tambah part</Link>
      </div>
      {saved && <p className="msg ok" role="status">{saved}</p>}
      <div className="card">
        <div className="filters">
          <label>Kategori <select value={kind} onChange={e => filter("kategori", e.target.value)}><option value="">Semua</option>
            {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Status <select value={active} onChange={e => filter("status", e.target.value)}>
            <option value="true">Aktif</option><option value="false">Nonaktif</option><option value="">Semua</option></select></label>
        </div>
        {!parts ? <Loading /> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Nama</th><th>Kategori</th><th>Kelas paket</th><th>Spesifikasi</th><th className="num">Harga satuan</th><th>Harga diperbarui</th><th>Toko</th><th /></tr></thead>
            <tbody>{parts.map(p => (
              <tr key={p.id} className={p.is_active ? "" : "off"}>
                <td>{p.name}{!p.is_active && <small>Nonaktif</small>}</td>
                <td>{CATEGORY[p.category]}{p.category === "inverter" && <small>{INVERTER_TYPE[p.system_type as string]}</small>}</td>
                <td>{p.package_tier ? TIER[p.package_tier as string] : p.category === "aksesoris" ? "" : "-"}</td>
                <td className="spec">{specOf(p)}</td>
                <td className="num">{rp(p.unit_price)}<small>per {p.unit}</small></td>
                <td className={Date.now() - Date.parse(p.price_updated_at) > STALE ? "bad" : ""}>{dateText(p.price_updated_at)}</td>
                <td>{p.buy_url ? <a href={p.buy_url} target="_blank" rel="noreferrer">{p.store_name ?? "Link beli"}</a> : p.store_name ?? "-"}</td>
                <td><Link className="btn sm" to={`/list-part/${p.id}/ubah`} state={back}>Ubah</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </section>
  )
}

// Halaman tambah atau ubah part, terpisah dari daftar. Setelah simpan atau batal, kembali ke daftar dengan filter yang sama.
export function PartFormPage() {
  const { id } = useParams(), navigate = useNavigate(), location = useLocation()
  const d = useApi<{ part: Part }>(id ? `/api/admin/parts/${id}` : null)
  const list = "/list-part" + ((location.state as { back?: string } | null)?.back ?? "")
  if (id && d.error) return <section className="wrap page narrow"><p className="msg bad" role="alert">{d.error}</p><Link to={list}>Kembali ke List Part</Link></section>
  if (id && !d.data) return <Loading />
  const part = d.data?.part ?? null
  return (
    <section className="wrap page narrow">
      <div className="head"><h1>{part ? `Ubah ${part.name}` : "Tambah part"}</h1></div>
      <PartForm part={part} onDone={saved => navigate(list, saved ? { state: { saved } } : undefined)} />
    </section>
  )
}

function PartForm({ part, onDone }: { part: Part | null; onDone: (saved?: string) => void }) {
  const [category, setCategory] = useState<Category>(part?.category ?? "panel")
  const [systemType, setSystemType] = useState(String(part?.system_type ?? "hybrid_offgrid"))
  const [basis, setBasis] = useState(String(part?.qty_basis ?? ""))
  const act = useAction()
  const numOr = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v))
  const strOr = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : String(v))
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const body: Record<string, unknown> = { name: f.get("name"), unit: f.get("unit"), unit_price: Number(f.get("unit_price")), store_name: f.get("store_name") || null,
      buy_url: f.get("buy_url") || null, notes: f.get("notes") || null, is_active: f.get("is_active") === "on",
      ...Object.fromEntries([...TECH[category], ...OPTIONAL[category]].map(([k]) => [k, numOr(f.get(k))])) }
    if (category !== "aksesoris") body.package_tier = strOr(f.get("package_tier"))
    if (category === "inverter") { body.system_type = systemType; body.battery_system_v = systemType === "on_grid" ? null : numOr(f.get("battery_system_v")) }
    if (category === "baterai") body.battery_system_v = numOr(f.get("battery_system_v"))
    if (category === "aksesoris") Object.assign(body, { qty_basis: basis || null, qty_per_basis: basis ? numOr(f.get("qty_per_basis")) : null })
    act.run(async () => {
      if (part) await api(`/api/admin/parts/${part.id}`, { method: "PATCH", body })
      else await api("/api/admin/parts", { body: { ...body, category } })
      onDone(`${String(body.name)} tersimpan.`)
    })
  }
  return (
    <form className="card form" onSubmit={save}>
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
        {OPTIONAL[category].map(([k, l, h]) => <Field key={`${category}-${k}`} label={l} name={k} type="number" step="any" min="0" hint={h} defaultValue={(part?.[k] as number | undefined) ?? ""} />)}
        {category !== "aksesoris" && <div className="field"><label htmlFor="part-tier">Kelas paket</label><div className="box">
          <select id="part-tier" name="package_tier" defaultValue={String(part?.package_tier ?? "")}>
            <option value="">Tanpa kelas (hanya lewat Atur sendiri)</option>{Object.entries(TIER).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <span className="hint">Paket Hemat, Standar, dan Premium di Simulator disusun dari part berkelas ini.</span></div>}
        {category === "aksesoris" && <>
          <div className="field"><label htmlFor="qty-basis">Dipakai di estimasi Simulator</label><div className="box">
            <select id="qty-basis" value={basis} onChange={e => setBasis(e.target.value)}>
              <option value="">Tidak (hanya di Planning)</option>{Object.entries(BASIS).map(([k, l]) => <option key={k} value={k}>Ya, {l}</option>)}</select></div>
            <span className="hint">Jumlah kasar untuk estimasi aksesoris, misalnya kabel PV 30 meter per string. Berlaku untuk hybrid dan on-grid.</span></div>
          {basis && <Field label={`Jumlah per ${BASIS[basis].replace("per ", "")}`} name="qty_per_basis" type="number" step="any" min="0"
            defaultValue={(part?.qty_per_basis as number | undefined) ?? ""} required />}
        </>}
      </div>
      <div className="field"><label htmlFor="part-notes">Catatan</label><textarea id="part-notes" name="notes" rows={2} defaultValue={part?.notes ?? ""} /></div>
      <label className="check"><input type="checkbox" name="is_active" defaultChecked={part?.is_active ?? true} /> Aktif (muncul di pilihan Simulator dan Planning)</label>
      <Message msg={act.msg} />
      <div className="actions"><button className="btn pri" disabled={act.busy}>Simpan</button><button type="button" className="btn" onClick={() => onDone()}>Batal</button></div>
    </form>
  )
}
