import { useEffect, useState, type FormEvent } from "react"
import { fmtNum, rp } from "../../../../shared/format"
import { api, fileBlob, openFile, uploadFile } from "../../core/api"
import { Field, Loading, Message, useAction } from "../../core/ui"
import { dateText, todayWib, useApi } from "../../core/useApi"

interface ClientView {
  groups: { group: string; label: string; subtotal: number; purchases: { id: string; items: { name: string; unit: string | null; qty: number; unit_price: number }[];
    total_paid: number; store_name: string; purchase_date: string; note: string; file_id: string | null }[] }[]
  total: number
  recap: { a_billed_parts: number; b_extra_parts_by_client: number; c_actual_spend: number; d_borne_by_us: number; refund_due: number; refunded: number; shortfall_undecided: number }
  part_adjustments: { amount: number; explanation: string; borne_by: string; client_approved_at: string | null }[]
  refunds: { amount: number; refunded_at: string; method: string; proof_file_id: string | null }[]
}

// Invoice Pembelian (PRD bagian 10 dan 8.4). Client melihat tabel, file asli, dan rekap; admin juga mengelola draf,
// Biaya Tambahan, tagihan tambahan, dan pengembalian.
export default function PurchasesTab({ projectId, admin = false, onChange }: { projectId: string; admin?: boolean; onChange?: () => void }) {
  const view = useApi<ClientView>(`/api/projects/${projectId}/purchases`)
  const reload = () => { view.reload(); onChange?.() }
  if (!view.data) return <Loading />
  const v = view.data
  return (
    <>
      {admin && <Drafts projectId={projectId} onChange={reload} />}
      <div className="card">
        <div className="head">
          <h2>Rincian belanja</h2>
          {v.total > 0 && <button type="button" className="btn sm" onClick={() => openFile(`/api/projects/${projectId}/purchases/gabungan.pdf`)}>Unduh gabungan (PDF)</button>}
        </div>
        {v.total === 0 && <p className="sub">Belum ada pembelian terkonfirmasi.</p>}
        {v.groups.filter(g => g.purchases.length).map(g => <GroupTable key={g.group} g={g} />)}
        {v.total > 0 && <p className="grand">Total keseluruhan: <b>{rp(v.total)}</b></p>}
      </div>
      <Recap v={v} />
      {admin && <Adjustments projectId={projectId} onChange={reload} />}
      {admin && <Refund projectId={projectId} remaining={v.recap.refund_due - v.recap.refunded} onChange={reload} />}
    </>
  )
}

// Tabel meniru sheet "Rincian Belanja" (PRD 10.3): satu pembelian bisa beberapa baris barang.
function GroupTable({ g }: { g: ClientView["groups"][number] }) {
  let no = 0
  return (
    <section aria-label={g.label}>
      <h3>{g.label}</h3>
      <div className="table-wrap wide"><table className="data">
        <thead><tr><th>No</th><th>Nama komponen</th><th>Satuan dan Qty</th><th className="num">Harga satuan</th><th className="num">Total dibayar</th><th>Lokasi beli</th><th>Keterangan</th></tr></thead>
        <tbody>
          {g.purchases.map(p => p.items.map((i, k) => (
            <tr key={`${p.id}-${k}`}>
              <td>{++no}</td><td>{i.name}</td><td>{fmtNum(i.qty)} {i.unit}</td><td className="num">{rp(i.unit_price)}</td>
              {k === 0 && <>
                <td className="num" rowSpan={p.items.length}>{rp(p.total_paid)}</td>
                <td rowSpan={p.items.length}>{p.store_name}<small>{dateText(p.purchase_date)}</small></td>
                <td rowSpan={p.items.length}>{p.file_id ? <button type="button" className="link" onClick={() => openFile(`/api/files/${p.file_id}`)}>{p.note}</button> : p.note}</td>
              </>}
            </tr>
          )))}
        </tbody>
        <tfoot><tr><th colSpan={4}>Subtotal {g.label}</th><th className="num">{rp(g.subtotal)}</th><th colSpan={2} /></tr></tfoot>
      </table></div>
      {/* Di HP tabel 7 kolom diganti kartu per pembelian (PRD bagian 12: nyaman dipakai di HP). */}
      <ul className="buy-cards">
        {g.purchases.map(p => (
          <li key={p.id}>
            <div className="buy-head"><b>{p.store_name}</b><b>{rp(p.total_paid)}</b></div>
            <small>{dateText(p.purchase_date)} · {p.file_id ? <button type="button" className="link" onClick={() => openFile(`/api/files/${p.file_id}`)}>{p.note}</button> : p.note}</small>
            <ul>{p.items.map((i, k) => <li key={k}>{i.name}: {fmtNum(i.qty)} {i.unit} × {rp(i.unit_price)}</li>)}</ul>
          </li>
        ))}
        <li className="buy-sum">Subtotal {g.label}: <b>{rp(g.subtotal)}</b></li>
      </ul>
    </section>
  )
}

// Rekap akhir (PRD 8.4). Hanya kelompok Part yang dihitung ulang terhadap belanja aktual.
function Recap({ v }: { v: ClientView }) {
  const r = v.recap
  return (
    <div className="card">
      <h2>Rekap biaya part</h2>
      <table className="data recap"><tbody>
        <tr><td>A. Ditagih untuk part</td><td className="num">{rp(r.a_billed_parts)}</td></tr>
        <tr><td>B. Biaya tambahan part disetujui client</td><td className="num">{rp(r.b_extra_parts_by_client)}</td></tr>
        <tr><td>C. Belanja aktual</td><td className="num">{rp(r.c_actual_spend)}</td></tr>
        <tr><td>D. Ditanggung kami</td><td className="num">{rp(r.d_borne_by_us)}</td></tr>
        <tr><th>Dikembalikan ke client (A + B − C)</th><th className="num">{rp(r.refund_due)}</th></tr>
        <tr><td>Sudah dikembalikan</td><td className="num">{rp(r.refunded)}</td></tr>
        {r.shortfall_undecided > 0 && <tr className="bad"><td>Kekurangan yang belum diputuskan</td><td className="num">{rp(r.shortfall_undecided)}</td></tr>}
      </tbody></table>
      {v.part_adjustments.length > 0 && (
        <>
          <h3>Biaya tambahan part</h3>
          <ul className="plain">{v.part_adjustments.map((a, i) => <li key={i}>{rp(a.amount)}: {a.explanation}, ditanggung {a.borne_by === "kami" ? "kami" : "client"}</li>)}</ul>
        </>
      )}
      {v.refunds.length > 0 && (
        <>
          <h3>Pengembalian</h3>
          <ul className="plain">{v.refunds.map((x, i) => (
            <li key={i}>{dateText(x.refunded_at)}: {rp(x.amount)} lewat {x.method}
              {x.proof_file_id && <> · <button type="button" className="link" onClick={() => openFile(`/api/files/${x.proof_file_id}`)}>bukti</button></>}</li>
          ))}</ul>
        </>
      )}
    </div>
  )
}

interface Purchase {
  id: string; status: "draf" | "terkonfirmasi"; document_type: "invoice" | "nota" | "tanpa_nota"; file_id: string | null; check_passed: boolean | null
  item_group: string | null; store_name: string | null; purchase_date: string | null; invoice_number: string | null
  subtotal_products: number; discount: number; shipping: number; shipping_discount: number; other_fees: number; total_paid: number
  items: { name: string; unit: string | null; qty: number; unit_price: number; part_id: string | null }[]
}
const MONEY = [["subtotal_products", "Subtotal barang"], ["discount", "Potongan"], ["shipping", "Ongkir"], ["shipping_discount", "Potongan ongkir"],
  ["other_fees", "Biaya lain"], ["total_paid", "Total dibayar"]] as const
const DOC = { invoice: "Invoice toko online", nota: "Nota tulisan tangan", tanpa_nota: "Tanpa nota" }

// Unggah satu file per pembelian; hasil baca (atau isi manual) masuk sebagai draf (PRD 10.1).
function Drafts({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const d = useApi<{ purchases: Purchase[] }>(`/api/admin/projects/${projectId}/purchases`)
  const [doc, setDoc] = useState<keyof typeof DOC>("invoice"), act = useAction()
  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget, f = new FormData(form), file = f.get("file") as File | null
    act.run(async () => {
      const fileId = doc !== "tanpa_nota" && file?.size ? (await uploadFile(projectId, "invoice_pembelian", file)).id : undefined
      if (doc !== "tanpa_nota" && !fileId) throw new Error("Pilih file invoice atau nota dulu.")
      await api(`/api/admin/projects/${projectId}/purchases`, { body: { document_type: doc, file_id: fileId, item_group: f.get("item_group") } })
      form.reset(); d.reload(); onChange()
    }, "Draf pembelian dibuat. Periksa isinya lalu konfirmasi.")
  }
  const drafts = d.data?.purchases.filter(p => p.status === "draf") ?? []
  return (
    <>
      <form className="card form" onSubmit={add}>
        <h2>Tambah pembelian</h2>
        <div className="field"><label htmlFor="doc-type">Jenis bukti</label>
          <div className="box"><select id="doc-type" value={doc} onChange={e => setDoc(e.target.value as keyof typeof DOC)}>
            {Object.entries(DOC).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div></div>
        <div className="field"><label htmlFor="item-group">Kelompok</label>
          <div className="box"><select id="item-group" name="item_group"><option value="komponen_utama">Komponen Utama</option><option value="aksesoris">Aksesoris</option></select></div></div>
        {doc !== "tanpa_nota" && <div className="field"><label htmlFor="purchase-file">File invoice atau nota (PDF, JPG, PNG)</label>
          <input id="purchase-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png" /></div>}
        <p className="hint">Isi file dibaca otomatis kalau pembaca invoice aktif. Kalau tidak terbaca, isi drafnya manual.</p>
        <Message msg={act.msg} />
        <button className="btn pri" disabled={act.busy}>{act.busy ? "Membaca file..." : "Buat draf"}</button>
      </form>
      {drafts.map(p => <Draft key={p.id} p={p} onChange={() => { d.reload(); onChange() }} />)}
    </>
  )
}

function Draft({ p, onChange }: { p: Purchase; onChange: () => void }) {
  const parts = useApi<{ parts: { id: string; name: string; is_active: boolean }[] }>("/api/admin/parts?active=true")
  const [h, setH] = useState(p), [items, setItems] = useState(p.items.length ? p.items : [{ name: "", unit: "", qty: 1, unit_price: 0, part_id: null }])
  const act = useAction(), [warning, setWarning] = useState("")
  const setItem = (i: number, patch: Partial<Purchase["items"][number]>) => setItems(xs => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  const body = () => ({ item_group: h.item_group, store_name: h.store_name || null, purchase_date: h.purchase_date || null, invoice_number: h.invoice_number || null,
    ...Object.fromEntries(MONEY.map(([k]) => [k, Number(h[k]) || 0])),
    items: items.map(i => ({ name: i.name, unit: i.unit || null, qty: Number(i.qty), unit_price: Number(i.unit_price), part_id: i.part_id || null })) })
  const save = () => act.run(async () => { const r = await api<{ purchase: Purchase }>(`/api/admin/purchases/${p.id}`, { method: "PATCH", body: body() })
    // Hanya hasil pengecekan jumlah yang diambil dari backend, supaya isian yang sedang diketik tidak tertimpa.
    setH(x => ({ ...x, check_passed: r.purchase.check_passed })) }, "Draf tersimpan.")
  const confirm = () => act.run(async () => {
    await api(`/api/admin/purchases/${p.id}`, { method: "PATCH", body: body() })
    const r = await api<{ warning?: string }>(`/api/admin/purchases/${p.id}/confirm`, { body: {} })
    if (r.warning) setWarning(r.warning)
    onChange()
  })
  return (
    <div className="card form draft">
      <div className="head">
        <h2>Draf: {DOC[p.document_type]}</h2>
        <span className={`pill ${h.check_passed === false ? "bad" : "ok"}`}>{h.check_passed === null ? "Tanpa pengecekan" : h.check_passed ? "Jumlah cocok" : "Perlu dicek"}</span>
      </div>
      <div className={p.file_id ? "draft-body" : ""}>
      {p.file_id && <Preview fileId={p.file_id} />}
      <div className="draft-form">
      <div className="fields">
        <div className="field"><label htmlFor={`g-${p.id}`}>Kelompok</label><div className="box"><select id={`g-${p.id}`} value={h.item_group ?? ""} onChange={e => setH({ ...h, item_group: e.target.value })}>
          <option value="" disabled>Pilih</option><option value="komponen_utama">Komponen Utama</option><option value="aksesoris">Aksesoris</option></select></div></div>
        <Field label="Toko" value={h.store_name ?? ""} onChange={e => setH({ ...h, store_name: e.target.value })} />
        <Field label="Tanggal beli" type="date" value={h.purchase_date ?? ""} onChange={e => setH({ ...h, purchase_date: e.target.value })} />
        <Field label="Nomor invoice" value={h.invoice_number ?? ""} onChange={e => setH({ ...h, invoice_number: e.target.value })} />
        {MONEY.map(([k, l]) => <Field key={k} label={l} type="number" min="0" value={h[k]} onChange={e => setH({ ...h, [k]: e.target.value })} />)}
      </div>
      <div className="table-wrap"><table className="data lines">
        <thead><tr><th>Nama barang</th><th>Satuan</th><th>Qty</th><th>Harga satuan</th><th>Part di List Part</th><th /></tr></thead>
        <tbody>{items.map((i, k) => (
          <tr key={k}>
            <td><input aria-label="Nama barang" value={i.name} onChange={e => setItem(k, { name: e.target.value })} /></td>
            <td><input aria-label="Satuan barang" value={i.unit ?? ""} onChange={e => setItem(k, { unit: e.target.value })} /></td>
            <td><input aria-label="Qty" type="number" step="any" min="0" value={i.qty} onChange={e => setItem(k, { qty: Number(e.target.value) })} /></td>
            <td><input aria-label="Harga satuan barang" type="number" min="0" value={i.unit_price} onChange={e => setItem(k, { unit_price: Number(e.target.value) })} /></td>
            <td><select aria-label="Part terkait" value={i.part_id ?? ""} onChange={e => setItem(k, { part_id: e.target.value || null })}>
              <option value="">Tidak ada</option>{parts.data?.parts.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
            <td><button type="button" className="btn sm danger" onClick={() => setItems(xs => xs.filter((_, j) => j !== k))}>Hapus</button></td>
          </tr>
        ))}</tbody>
      </table></div>
      <button type="button" className="btn sm" onClick={() => setItems(xs => [...xs, { name: "", unit: "", qty: 1, unit_price: 0, part_id: null }])}>Tambah barang</button>
      <Message msg={act.msg} />
      {warning && <p className="msg warn">{warning}</p>}
      <div className="actions"><button type="button" className="btn" disabled={act.busy} onClick={save}>Simpan draf</button>
        <button type="button" className="btn pri" disabled={act.busy} onClick={confirm}>Konfirmasi</button></div>
      </div>
      </div>
    </div>
  )
}

// Draf tampil di samping preview file aslinya (PRD 10.1 langkah 4). File diambil lewat backend setelah cek pemilik.
function Preview({ fileId }: { fileId: string }) {
  const [file, setFile] = useState<{ url: string; type: string } | null>(null)
  useEffect(() => {
    let url = ""
    fileBlob(`/api/files/${fileId}`).then(b => { url = URL.createObjectURL(b); setFile({ url, type: b.type }) }, () => {})
    return () => URL.revokeObjectURL(url)
  }, [fileId])
  return (
    <div className="preview">
      {file && (file.type.startsWith("image/") ? <img src={file.url} alt="File invoice pembelian" /> : <iframe src={file.url} title="File invoice pembelian" />)}
      <button type="button" className="btn sm" onClick={() => openFile(`/api/files/${fileId}`)}>Buka di tab baru</button>
    </div>
  )
}

interface Adjustment { id: string; category: string; amount: number; reason: string; explanation: string; borne_by: "kami" | "client"; client_approved_at: string | null; proof_file_id: string | null; invoice_id: string | null }
const REASON = { kesalahan_kami: "Kesalahan kami", kondisi_lokasi: "Kondisi lokasi", kenaikan_harga: "Kenaikan harga", lainnya: "Lainnya" }
const CATEGORY = { part: "Part", sdm: "SDM", jasa: "Jasa", akomodasi: "Akomodasi" }

// Biaya Tambahan (PRD 8.3): admin memutuskan penanggungnya. Tagihan tambahan hanya untuk biaya client yang bukti setujunya ada.
function Adjustments({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const d = useApi<{ cost_adjustments: Adjustment[] }>(`/api/admin/projects/${projectId}/cost-adjustments`)
  const act = useAction(), bill = useAction(), [picked, setPicked] = useState<string[]>([])
  const after = () => { d.reload(); onChange() }
  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget, f = new FormData(form), proof = f.get("proof") as File | null
    act.run(async () => {
      const proofId = proof?.size ? (await uploadFile(projectId, "bukti_setuju", proof)).id : null
      await api(`/api/admin/projects/${projectId}/cost-adjustments`, { body: { category: f.get("category"), amount: Number(f.get("amount")), reason: f.get("reason"),
        explanation: f.get("explanation"), borne_by: f.get("borne_by"), client_approved_at: f.get("client_approved_at") || null, proof_file_id: proofId } })
      form.reset(); after()
    }, "Biaya Tambahan tercatat.")
  }
  const invoice = () => bill.run(async () => {
    await api(`/api/admin/projects/${projectId}/invoices/tambahan`, { body: { cost_adjustment_ids: picked } }); setPicked([]); after()
  }, "Tagihan tambahan terbit. Lihat di tab Penagihan.")
  const open = d.data?.cost_adjustments.filter(x => x.borne_by === "client" && !x.invoice_id) ?? []
  return (
    <div className="card form">
      <h2>Biaya Tambahan</h2>
      {d.data?.cost_adjustments.length ? (
        <ul className="plain">{d.data.cost_adjustments.map(x => (
          <li key={x.id}>
            <b>{CATEGORY[x.category as keyof typeof CATEGORY]} {rp(x.amount)}</b>, {REASON[x.reason as keyof typeof REASON].toLowerCase()}: {x.explanation}.
            Ditanggung {x.borne_by}.{x.borne_by === "client" && (x.client_approved_at ? ` Disetujui ${dateText(x.client_approved_at)}.` : " Belum ada bukti setuju.")}
            {x.invoice_id && " Sudah ditagihkan."}
            {x.borne_by === "client" && !x.invoice_id && !(x.client_approved_at && x.proof_file_id) && <Approve projectId={projectId} x={x} onDone={after} />}
          </li>
        ))}</ul>
      ) : <p className="sub">Belum ada Biaya Tambahan.</p>}
      {open.length > 0 && (
        <fieldset className="pick">
          <legend>Buat tagihan tambahan dari biaya tanggungan client</legend>
          {open.map(x => (
            <label key={x.id}><input type="checkbox" checked={picked.includes(x.id)} onChange={e => setPicked(p => e.target.checked ? [...p, x.id] : p.filter(id => id !== x.id))} />
              {CATEGORY[x.category as keyof typeof CATEGORY]} {rp(x.amount)}: {x.explanation}</label>
          ))}
          <button type="button" className="btn pri" disabled={bill.busy || !picked.length} onClick={invoice}>Buat tagihan tambahan</button>
        </fieldset>
      )}
      <Message msg={bill.msg} />
      <form className="form" onSubmit={add}>
        <h3>Catat Biaya Tambahan</h3>
        <div className="fields">
          <div className="field"><label htmlFor="adj-cat">Kelompok biaya</label><div className="box"><select id="adj-cat" name="category">
            {Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div></div>
          <Field label="Jumlah" name="amount" type="number" min="1" required />
          <div className="field"><label htmlFor="adj-reason">Alasan</label><div className="box"><select id="adj-reason" name="reason">
            {Object.entries(REASON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div></div>
          <div className="field"><label htmlFor="adj-by">Penanggung</label><div className="box"><select id="adj-by" name="borne_by">
            <option value="client">Client</option><option value="kami">Kami</option></select></div></div>
        </div>
        <Field label="Penjelasan" name="explanation" required />
        <Field label="Tanggal client setuju" name="client_approved_at" type="date" hint="Boleh diisi belakangan, wajib sebelum tagihan tambahan dibuat." />
        <div className="field"><label htmlFor="adj-proof">Bukti setuju client</label><input id="adj-proof" name="proof" type="file" accept="application/pdf,image/jpeg,image/png" /></div>
        <Message msg={act.msg} />
        <button className="btn" disabled={act.busy}>Catat</button>
      </form>
    </div>
  )
}

function Approve({ projectId, x, onDone }: { projectId: string; x: Adjustment; onDone: () => void }) {
  const [open, setOpen] = useState(false), act = useAction()
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget), proof = f.get("proof") as File | null
    act.run(async () => {
      const proofId = proof?.size ? (await uploadFile(projectId, "bukti_setuju", proof)).id : x.proof_file_id
      await api(`/api/admin/cost-adjustments/${x.id}`, { method: "PATCH", body: { client_approved_at: f.get("client_approved_at"), proof_file_id: proofId } })
      onDone()
    })
  }
  if (!open) return <> <button type="button" className="link" onClick={() => setOpen(true)}>Isi bukti setuju</button></>
  return (
    <form className="form inline" onSubmit={save}>
      <Field label="Tanggal setuju" name="client_approved_at" type="date" defaultValue={todayWib()} required />
      <div className="field"><label htmlFor={`ap-${x.id}`}>File bukti</label><input id={`ap-${x.id}`} name="proof" type="file" accept="application/pdf,image/jpeg,image/png" required={!x.proof_file_id} /></div>
      <Message msg={act.msg} />
      <button className="btn sm" disabled={act.busy}>Simpan bukti</button>
    </form>
  )
}

// Pengembalian kelebihan bayar ke client (PRD 8.4).
function Refund({ projectId, remaining, onChange }: { projectId: string; remaining: number; onChange: () => void }) {
  const act = useAction()
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget, f = new FormData(form), proof = f.get("proof") as File | null
    act.run(async () => {
      const proofId = proof?.size ? (await uploadFile(projectId, "bukti_pengembalian", proof)).id : null
      await api(`/api/admin/projects/${projectId}/refunds`, { body: { amount: Number(f.get("amount")), refunded_at: f.get("refunded_at"), method: f.get("method"),
        proof_file_id: proofId, note: f.get("note") || null } })
      form.reset(); onChange()
    }, "Pengembalian tercatat.")
  }
  if (remaining <= 0) return act.msg ? <Message msg={act.msg} /> : null
  return (
    <form className="card form" onSubmit={save}>
      <h2>Catat pengembalian</h2>
      <p className="sub">Sisa yang harus dikembalikan ke client: {rp(remaining)}.</p>
      <Field label="Jumlah dikembalikan" name="amount" type="number" min="1" max={remaining} defaultValue={remaining} required />
      <Field label="Tanggal" name="refunded_at" type="date" defaultValue={todayWib()} required />
      <Field label="Metode" name="method" defaultValue="Transfer" required />
      <div className="field"><label htmlFor="refund-proof">Bukti transfer</label><input id="refund-proof" name="proof" type="file" accept="application/pdf,image/jpeg,image/png" /></div>
      <Field label="Catatan" name="note" />
      <Message msg={act.msg} />
      <button className="btn pri" disabled={act.busy}>Simpan pengembalian</button>
    </form>
  )
}
