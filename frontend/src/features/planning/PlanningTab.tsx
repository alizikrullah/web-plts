import { useEffect, useState } from "react"
import { fmtNum, rp } from "../../../../shared/format"
import { api } from "../../core/api"
import { Loading, Message, useAction } from "../../core/ui"
import { dateText, useApi } from "../../core/useApi"

type Type = "part" | "sdm" | "jasa" | "akomodasi"
interface Item { type: Type; part_id?: string | null; description?: string | null; unit?: string | null; qty?: number | null; days?: number | null; unit_price?: number | null; subtotal?: number }
interface Planning { status: "draf" | "final"; site_notes: string | null; price_valid_until: string | null; total_parts: number; total_labor: number; total_services: number; total_accommodation: number; grand_total: number }
interface Part { id: string; name: string; category: string; unit: string; unit_price: number; is_active: boolean }

const GROUPS: { type: Type; label: string; total: keyof Planning }[] = [
  { type: "part", label: "Part", total: "total_parts" }, { type: "sdm", label: "SDM", total: "total_labor" },
  { type: "jasa", label: "Jasa", total: "total_services" }, { type: "akomodasi", label: "Akomodasi", total: "total_accommodation" },
]
// Subtotal dihitung ulang di backend saat disimpan; di layar dihitung juga supaya langsung terlihat (PRD 7.4).
const sub = (i: Item, rate: number | null) =>
  i.type === "part" ? Math.round((i.qty ?? 0) * (i.unit_price ?? 0)) : i.type === "sdm" ? Math.round((i.qty ?? 0) * (i.days ?? 0) * (i.unit_price ?? rate ?? 0)) : i.unit_price ?? 0
const num = (v: string) => (v === "" ? null : Number(v))

// Planning (PRD 7.4): empat kelompok biaya, catatan lokasi, final dengan tanggal harga berlaku, terkunci setelah tagihan terbit.
export default function PlanningTab({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const d = useApi<{ planning: Planning; items: Item[]; locked: boolean }>(`/api/admin/projects/${projectId}/planning`)
  const parts = useApi<{ parts: Part[] }>("/api/admin/parts")
  const settings = useApi<{ settings: { key: string; value: unknown }[] }>("/api/admin/settings")
  const [items, setItems] = useState<Item[]>([]), [notes, setNotes] = useState(""), [until, setUntil] = useState("")
  const act = useAction()
  useEffect(() => { if (d.data) { setItems(d.data.items); setNotes(d.data.planning.site_notes ?? "") } }, [d.data])
  if (!d.data || !parts.data) return <Loading />
  const { planning, locked } = d.data, editable = planning.status === "draf" && !locked
  const rate = (settings.data?.settings.find(s => s.key === "labor_rate_per_day")?.value as number | null) ?? null
  const partOf = (id?: string | null) => parts.data!.parts.find(p => p.id === id)
  const set = (i: number, patch: Partial<Item>) => setItems(xs => xs.map((x, n) => (n === i ? { ...x, ...patch } : x)))
  const add = (type: Type) => setItems(xs => [...xs, type === "part" ? { type, qty: 1 } : type === "sdm" ? { type, qty: 2, days: 1 } : { type, description: "" }])
  const total = items.reduce((s, i) => s + sub(i, rate), 0)
  const after = () => { d.reload(); onChange() }
  const save = () => act.run(async () => {
    await api(`/api/admin/projects/${projectId}/planning`, { method: "PUT", body: { site_notes: notes || null, items: items.map(i => ({
      type: i.type, part_id: i.part_id ?? undefined, description: i.description || undefined, unit: i.unit || undefined, qty: i.qty ?? undefined,
      days: i.days ?? undefined, unit_price: i.unit_price ?? undefined })) } })
    after()
  }, "Planning tersimpan.")
  const finalize = () => act.run(async () => {
    await api(`/api/admin/projects/${projectId}/planning/finalize`, { body: until ? { price_valid_until: until } : {} }); after()
  }, "Planning sudah final.")
  const reopen = () => act.run(async () => { await api(`/api/admin/projects/${projectId}/planning/reopen`, { body: {} }); after() }, "Planning kembali ke draf.")

  return (
    <div className="card form">
      <div className="head">
        <h2>Planning ({planning.status === "final" ? "final" : "draf"})</h2>
        {planning.price_valid_until && <span className="sub">Harga berlaku sampai {dateText(planning.price_valid_until)}</span>}
      </div>
      {locked && <p className="msg warn">Tagihan sudah terbit, jadi Planning terkunci. Perubahan biaya dicatat sebagai Biaya Tambahan di tab Invoice Pembelian.</p>}
      {GROUPS.map(g => {
        const rows = items.map((i, n) => [i, n] as const).filter(([i]) => i.type === g.type)
        return (
          <section key={g.type} className="group-lines" aria-label={g.label}>
            <h3>{g.label}</h3>
            {!editable && rows.length === 0 ? <p className="sub">Tidak ada.</p> : (
            <div className="table-wrap"><table className="data lines">
              <thead><tr>{g.type === "part" ? <><th>Part</th><th>Jumlah</th><th>Satuan</th><th>Harga satuan</th></>
                : g.type === "sdm" ? <><th>Keterangan</th><th>Orang</th><th>Hari</th><th>Tarif per orang per hari</th></>
                : <><th>Uraian</th><th>Nominal</th></>}<th className="num">Subtotal</th>{editable && <th />}</tr></thead>
              <tbody>
                {rows.map(([i, n]) => (
                  <tr key={n}>
                    {!editable ? (
                      g.type === "part" ? <><td>{i.description ?? partOf(i.part_id)?.name}</td><td>{fmtNum(i.qty ?? 0)}</td><td>{i.unit}</td><td>{rp(i.unit_price ?? 0)}</td></>
                      : g.type === "sdm" ? <><td>{i.description}</td><td>{fmtNum(i.qty ?? 0)}</td><td>{fmtNum(i.days ?? 0)}</td><td>{rp(i.unit_price ?? rate ?? 0)}</td></>
                      : <><td>{i.description}</td><td>{rp(i.unit_price ?? 0)}</td></>
                    ) : g.type === "part" ? (
                      <>
                        <td><select aria-label="Part" value={i.part_id ?? ""} onChange={e => { const p = partOf(e.target.value); set(n, { part_id: e.target.value, unit: p?.unit, unit_price: p?.unit_price, description: null }) }}>
                          <option value="" disabled>Pilih part</option>
                          {parts.data!.parts.filter(p => p.is_active || p.id === i.part_id).map(p => <option key={p.id} value={p.id}>{p.name}{!p.is_active && " (nonaktif)"}</option>)}
                        </select></td>
                        <td><input aria-label="Jumlah" type="number" step="any" min="0" value={i.qty ?? ""} onChange={e => set(n, { qty: num(e.target.value) })} /></td>
                        <td><input aria-label="Satuan" value={i.unit ?? ""} onChange={e => set(n, { unit: e.target.value })} /></td>
                        <td><input aria-label="Harga satuan" type="number" min="0" value={i.unit_price ?? ""} onChange={e => set(n, { unit_price: num(e.target.value) })} /></td>
                      </>
                    ) : g.type === "sdm" ? (
                      <>
                        <td><input aria-label="Keterangan" value={i.description ?? ""} placeholder="Tenaga pasang" onChange={e => set(n, { description: e.target.value })} /></td>
                        <td><input aria-label="Orang" type="number" step="any" min="0" value={i.qty ?? ""} onChange={e => set(n, { qty: num(e.target.value) })} /></td>
                        <td><input aria-label="Hari" type="number" step="any" min="0" value={i.days ?? ""} onChange={e => set(n, { days: num(e.target.value) })} /></td>
                        <td><input aria-label="Tarif" type="number" min="0" value={i.unit_price ?? ""} placeholder={rate === null ? "Wajib diisi" : `Bawaan ${rp(rate)}`} onChange={e => set(n, { unit_price: num(e.target.value) })} /></td>
                      </>
                    ) : (
                      <>
                        <td><input aria-label="Uraian" value={i.description ?? ""} onChange={e => set(n, { description: e.target.value })} /></td>
                        <td><input aria-label="Nominal" type="number" min="0" value={i.unit_price ?? ""} onChange={e => set(n, { unit_price: num(e.target.value) })} /></td>
                      </>
                    )}
                    <td className="num">{rp(sub(i, rate))}</td>
                    {editable && <td><button type="button" className="btn sm danger" aria-label={`Hapus baris ${g.label}`} onClick={() => setItems(xs => xs.filter((_, k) => k !== n))}>Hapus</button></td>}
                  </tr>
                ))}
              </tbody>
            </table></div>)}
            <div className="line-foot">
              {editable && <button type="button" className="btn sm" onClick={() => add(g.type)}>Tambah {g.label}</button>}
              <b>Total {g.label}: {rp(rows.reduce((s, [i]) => s + sub(i, rate), 0))}</b>
            </div>
          </section>
        )
      })}
      <p className="grand">Total keseluruhan: <b>{rp(editable ? total : planning.grand_total)}</b></p>
      {editable ? (
        <div className="field"><label htmlFor="site-notes">Catatan kondisi lokasi</label>
          <textarea id="site-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></div>
      ) : <div><h3>Catatan kondisi lokasi</h3><p className="pre sub">{notes || "Tidak ada catatan."}</p></div>}
      <Message msg={act.msg} />
      {editable && (
        <>
          <div className="actions"><button type="button" className="btn pri" disabled={act.busy} onClick={save}>Simpan draf</button></div>
          <div className="field"><label htmlFor="until">Harga berlaku sampai</label>
            <input id="until" type="date" value={until} onChange={e => setUntil(e.target.value)} />
            <span className="hint">Kosongkan untuk memakai jumlah hari di Pengaturan. Simpan draf dulu sebelum dijadikan final.</span></div>
          <div className="actions"><button type="button" className="btn" disabled={act.busy} onClick={finalize}>Jadikan final</button></div>
        </>
      )}
      {planning.status === "final" && !locked && <div className="actions"><button type="button" className="btn" disabled={act.busy} onClick={reopen}>Kembalikan ke draf</button></div>}
    </div>
  )
}
