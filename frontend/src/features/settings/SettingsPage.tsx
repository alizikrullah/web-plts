import { useState, type FormEvent } from "react"
import { useSearchParams } from "react-router"
import { api } from "../../core/api"
import { Field, Loading, Message, useAction } from "../../core/ui"
import { dateText, useApi } from "../../core/useApi"
import ManageAccounts from "../account/ManageAccounts"
import type { Status } from "../projects/ProjectListPage"

type Kind = "text" | "long" | "number" | "mode" | "object"
interface Spec { key: string; label: string; kind: Kind; hint?: string; sub?: Record<string, string> }
const PATTERN = { sepi_siang: "Rumah sepi di siang hari (%)", seimbang: "Seimbang (%)", ramai_siang: "Rumah ramai di siang hari (%)" }
// Kelompok Pengaturan mengikuti PRD 11.3.
const GROUPS: { title: string; items: Spec[] }[] = [
  { title: "Kontak dan tagihan", items: [
    { key: "business_name", label: "Nama usaha", kind: "text", hint: "Boleh kosong. Kalau diisi, dicetak di bawah judul INVOICE." },
    { key: "whatsapp_number", label: "Nomor WhatsApp", kind: "text", hint: "Angka dengan kode negara, misalnya 6281234567890." },
    { key: "payment_instructions", label: "Cara pembayaran di tagihan", kind: "long" }] },
  { title: "Home", items: [
    { key: "service_area_text", label: "Teks area layanan", kind: "long" },
    { key: "proof_min_finished", label: "Batas minimal angka bukti (proyek selesai)", kind: "number" }] },
  { title: "Simulator", items: [
    { key: "tariff_per_va", label: "Tarif listrik per kWh tiap daya PLN", kind: "object" },
    { key: "sun_hours", label: "Jam matahari per hari", kind: "number" }, { key: "system_loss_pct", label: "Rugi-rugi sistem (%)", kind: "number" },
    { key: "panel_degradation_pct", label: "Degradasi panel (% per tahun)", kind: "number" }, { key: "tariff_escalation_pct", label: "Kenaikan tarif (% per tahun)", kind: "number" },
    { key: "work_mode", label: "Mode kerja", kind: "mode" }, { key: "battery_unlock_soc_pct", label: "SOC baterai sebelum lepas dari PLN (%)", kind: "number" },
    { key: "day_hours", label: "Jam siang", kind: "object", sub: { start: "Mulai jam", end: "Selesai jam" } },
    { key: "analysis_years", label: "Umur analisis (tahun)", kind: "number" }, { key: "inverter_replace_year", label: "Ganti inverter tahun ke (0 = tidak dihitung)", kind: "number" },
    { key: "battery_max_life_years", label: "Umur maksimal baterai (tahun)", kind: "number",
      hint: "Umur baterai dihitung dari jumlah siklus di List Part, lalu dibatasi angka ini." },
    { key: "day_share_pct", label: "Porsi siang tiap pola pemakaian", kind: "object", sub: PATTERN },
    { key: "panel_wp_per_va", label: "Faktor kapasitas panel (Wp per VA)", kind: "number", hint: "Kapasitas panel paket = daya PLN × angka ini." },
    { key: "accessories_estimate_pct", label: "Persen cadangan estimasi aksesoris (% dari komponen utama)", kind: "number",
      hint: "Hanya dipakai selama belum ada aksesoris dengan aturan jumlah untuk jenis sistem itu." },
    { key: "service_base", label: "Jasa dasar (Rp)", kind: "number", hint: "Estimasi jasa = jasa dasar + jasa per kWp × kapasitas panel." },
    { key: "service_per_kwp", label: "Jasa per kWp (Rp)", kind: "number" }] },
  { title: "Planning dan tagihan", items: [
    { key: "price_validity_days", label: "Lama harga berlaku (hari)", kind: "number" }, { key: "invoice_due_days", label: "Jatuh tempo tagihan (hari)", kind: "number" },
    { key: "labor_rate_per_day", label: "Tarif SDM bawaan per orang per hari (Rp)", kind: "number" }] },
  { title: "Perlu Tindakan", items: [
    { key: "action_thresholds", label: "Ambang hari", kind: "object", sub: { planning_days: "Planning belum final", no_update_days: "Pengerjaan tanpa update",
      refund_days: "Pengembalian belum dicatat", stale_price_days: "Harga part kedaluwarsa" } }] },
]
const SECTIONS = [["nilai", "Nilai"], ["faq", "FAQ"], ["status", "Status"], ["akun", "Kelola Akun"]] as const

// Pengaturan (PRD 11.3), termasuk Kelola Akun (PRD bagian 4).
export default function SettingsPage() {
  const [params, setParams] = useSearchParams(), part = params.get("bagian") ?? "nilai"
  return (
    <section className="wrap page">
      <h1>Pengaturan</h1>
      <nav className="tabs" aria-label="Bagian pengaturan">
        {SECTIONS.map(([k, l]) => <button key={k} type="button" aria-current={part === k ? "page" : undefined} onClick={() => setParams({ bagian: k }, { replace: true })}>{l}</button>)}
      </nav>
      {part === "nilai" && <Values />}
      {part === "faq" && <Faqs />}
      {part === "status" && <Statuses />}
      {part === "akun" && <ManageAccounts />}
    </section>
  )
}

function Values() {
  const d = useApi<{ settings: { key: string; value: unknown; updated_at: string; updated_by_name: string | null }[] }>("/api/admin/settings")
  if (!d.data) return <Loading />
  const row = (k: string) => d.data!.settings.find(s => s.key === k)
  return <>{GROUPS.map(g => (
    <div key={g.title} className="card form">
      <h2>{g.title}</h2>
      {g.items.map(s => { const r = row(s.key); return r ? <SettingRow key={s.key} spec={s} value={r.value} meta={r} onSaved={d.reload} /> : null })}
    </div>
  ))}</>
}

function SettingRow({ spec, value, meta, onSaved }: { spec: Spec; value: unknown; meta: { updated_at: string; updated_by_name: string | null }; onSaved: () => void }) {
  const isObj = spec.kind === "object" && value && typeof value === "object"
  const [v, setV] = useState<string | Record<string, string>>(() => isObj
    ? Object.fromEntries(Object.entries(value as Record<string, number>).map(([k, x]) => [k, String(x)])) : value == null ? "" : String(value))
  const act = useAction()
  const save = (e: FormEvent) => {
    e.preventDefault()
    const out = typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]))
      : v === "" ? null : spec.kind === "number" ? Number(v) : v
    act.run(async () => { await api(`/api/admin/settings/${spec.key}`, { method: "PUT", body: { value: out } }); onSaved() }, "Tersimpan.")
  }
  const id = `set-${spec.key}`
  return (
    <form className="setting" onSubmit={save}>
      {typeof v === "object" ? (
        <fieldset><legend>{spec.label}</legend><div className="fields">
          {(spec.sub ? Object.keys(spec.sub).filter(k => k in v) : Object.keys(v).sort((a, b) => +a - +b)).map(k => (
            <Field key={k} label={spec.sub?.[k] ?? `${Number(k).toLocaleString("id-ID")} VA`} type="number" step="any" value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })} required />
          ))}</div></fieldset>
      ) : spec.kind === "long" ? (
        <div className="field"><label htmlFor={id}>{spec.label}</label><textarea id={id} rows={3} value={v} onChange={e => setV(e.target.value)} /></div>
      ) : spec.kind === "mode" ? (
        <div className="field"><label htmlFor={id}>{spec.label}</label><div className="box"><select id={id} value={v} onChange={e => setV(e.target.value)}>
          <option value="SBU">SBU (baterai juga dipakai malam)</option><option value="SOL">SOL (baterai hanya siang)</option></select></div></div>
      ) : (
        <Field label={spec.label} type={spec.kind === "number" ? "number" : "text"} step="any" value={v} onChange={e => setV(e.target.value)} placeholder={value == null ? "Diisi tim" : undefined} />
      )}
      {spec.hint && <p className="hint">{spec.hint}</p>}
      <div className="setting-foot">
        <small>{meta.updated_by_name ? `Diubah ${meta.updated_by_name}, ${dateText(meta.updated_at)}` : value == null ? "Belum diisi" : "Nilai awal"}</small>
        <Message msg={act.msg} />
        <button className="btn sm" disabled={act.busy}>Simpan</button>
      </div>
    </form>
  )
}

interface Faq { id: string; question: string; answer: string; sort_order: number; is_active: boolean }
function Faqs() {
  const d = useApi<{ faqs: Faq[] }>("/api/admin/faqs"), add = useAction()
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget, f = new FormData(form)
    add.run(async () => { await api("/api/admin/faqs", { body: { question: f.get("question"), answer: f.get("answer"), sort_order: Number(f.get("sort_order")) || 0 } }); form.reset(); d.reload() }, "FAQ ditambahkan.")
  }
  if (!d.data) return <Loading />
  return (
    <>
      <p className="sub">Home menampilkan 5 FAQ aktif pertama menurut urutan. Jawabannya ditulis tim.</p>
      {d.data.faqs.map(f => <FaqRow key={f.id} f={f} onSaved={d.reload} />)}
      <form className="card form" onSubmit={create}>
        <h2>Tambah FAQ</h2>
        <Field label="Pertanyaan" name="question" required />
        <div className="field"><label htmlFor="new-answer">Jawaban</label><textarea id="new-answer" name="answer" rows={3} required /></div>
        <Field label="Urutan" name="sort_order" type="number" defaultValue={d.data.faqs.length + 1} />
        <Message msg={add.msg} />
        <button className="btn pri" disabled={add.busy}>Tambah</button>
      </form>
    </>
  )
}
function FaqRow({ f, onSaved }: { f: Faq; onSaved: () => void }) {
  const act = useAction()
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const x = new FormData(e.currentTarget)
    act.run(async () => { await api(`/api/admin/faqs/${f.id}`, { method: "PATCH", body: { question: x.get("question"), answer: x.get("answer"),
      sort_order: Number(x.get("sort_order")) || 0, is_active: x.get("is_active") === "on" } }); onSaved() }, "Tersimpan.")
  }
  return (
    <form className="card form" onSubmit={save}>
      <Field label="Pertanyaan" name="question" defaultValue={f.question} required />
      <div className="field"><label htmlFor={`a-${f.id}`}>Jawaban</label><textarea id={`a-${f.id}`} name="answer" rows={3} defaultValue={f.answer} required /></div>
      <div className="fields"><Field label="Urutan" name="sort_order" type="number" defaultValue={f.sort_order} />
        <label className="check"><input type="checkbox" name="is_active" defaultChecked={f.is_active} /> Aktif</label></div>
      <Message msg={act.msg} />
      <button className="btn sm" disabled={act.busy}>Simpan</button>
    </form>
  )
}

// Status dan sub-status (PRD 9.2). Status bawaan boleh diganti nama, tetapi tidak bisa dinonaktifkan.
function Statuses() {
  const d = useApi<{ statuses: Status[] }>("/api/admin/statuses"), add = useAction()
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget, f = new FormData(form)
    add.run(async () => { await api("/api/admin/statuses", { body: { name: f.get("name"), show_to_client: f.get("show_to_client") === "on", sort_order: Number(f.get("sort_order")) || 0 } }); form.reset(); d.reload() }, "Status ditambahkan.")
  }
  if (!d.data) return <Loading />
  return (
    <>
      {d.data.statuses.map(s => <StatusRow key={s.id} s={s} onSaved={d.reload} />)}
      <form className="card form" onSubmit={create}>
        <h2>Tambah status utama</h2>
        <Field label="Nama" name="name" required />
        <Field label="Urutan" name="sort_order" type="number" defaultValue={d.data.statuses.length + 1} />
        <label className="check"><input type="checkbox" name="show_to_client" defaultChecked /> Tampil di indikator client</label>
        <Message msg={add.msg} />
        <button className="btn pri" disabled={add.busy}>Tambah</button>
      </form>
    </>
  )
}
function StatusRow({ s, onSaved }: { s: Status; onSaved: () => void }) {
  const act = useAction(), addSub = useAction()
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    act.run(async () => { await api(`/api/admin/statuses/${s.id}`, { method: "PATCH", body: { name: f.get("name"), sort_order: Number(f.get("sort_order")) || 0,
      show_to_client: f.get("show_to_client") === "on", is_active: s.system_key ? true : f.get("is_active") === "on" } }); onSaved() }, "Tersimpan.")
  }
  function createSub(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget, f = new FormData(form)
    addSub.run(async () => { await api(`/api/admin/statuses/${s.id}/sub-statuses`, { body: { name: f.get("name"), sort_order: s.sub_statuses.length + 1 } }); form.reset(); onSaved() })
  }
  return (
    <div className="card form">
      <form className="form" onSubmit={save}>
        <div className="fields">
          <Field label={s.system_key ? `Nama status (bawaan: ${s.system_key})` : "Nama status"} name="name" defaultValue={s.name} required />
          <Field label="Urutan" name="sort_order" type="number" defaultValue={s.sort_order} />
        </div>
        <label className="check"><input type="checkbox" name="show_to_client" defaultChecked={s.show_to_client} /> Tampil di indikator client</label>
        <label className="check"><input type="checkbox" name="is_active" defaultChecked={s.is_active} disabled={!!s.system_key} /> Aktif{s.system_key && " (status bawaan selalu aktif)"}</label>
        <Message msg={act.msg} />
        <button className="btn sm" disabled={act.busy}>Simpan status</button>
      </form>
      {s.sub_statuses.map(x => <SubRow key={x.id} x={x} onSaved={onSaved} />)}
      <form className="form inline" onSubmit={createSub}>
        <Field label="Sub-status baru" name="name" required />
        <Message msg={addSub.msg} />
        <button className="btn sm" disabled={addSub.busy}>Tambah sub-status</button>
      </form>
    </div>
  )
}
function SubRow({ x, onSaved }: { x: Status["sub_statuses"][number]; onSaved: () => void }) {
  const act = useAction()
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    act.run(async () => { await api(`/api/admin/sub-statuses/${x.id}`, { method: "PATCH", body: { name: f.get("name"), sort_order: Number(f.get("sort_order")) || 0, is_active: f.get("is_active") === "on" } }); onSaved() })
  }
  return (
    <form className="form inline sub-row" onSubmit={save}>
      <Field label="Sub-status" name="name" defaultValue={x.name} required />
      <Field label="Urutan" name="sort_order" type="number" defaultValue={x.sort_order} />
      <label className="check"><input type="checkbox" name="is_active" defaultChecked={x.is_active} /> Aktif</label>
      <Message msg={act.msg} />
      <button className="btn sm" disabled={act.busy}>Simpan</button>
    </form>
  )
}
