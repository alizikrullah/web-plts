import { useState, type FormEvent } from "react"
import { rp } from "../../../../shared/format"
import { api, openFile, showFile, uploadFile } from "../../core/api"
import { Field, Loading, Message, useAction } from "../../core/ui"
import { dateText, todayWib, useApi } from "../../core/useApi"

interface Payment { id: string; amount: number; paid_at: string; method: string; proof_file_id: string | null; note: string | null }
interface Invoice {
  id: string; type: "awal" | "tambahan"; number: string; status: "terbit" | "lunas" | "batal"; issued_at: string; due_date: string
  price_valid_until: string | null; total: number; paid: number; pdf_file_id: string | null; payments: Payment[]
  items: { description: string; subtotal: number }[]
}
const STATUS = { terbit: "Belum lunas", lunas: "Lunas", batal: "Batal" }

// Penagihan (PRD 8.1 dan 8.2): tagihan awal dari Planning final, PDF, pembatalan, dan pembayaran dengan bukti.
export default function InvoicesTab({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const d = useApi<{ invoices: Invoice[] }>(`/api/admin/projects/${projectId}/invoices`)
  const act = useAction(), [checked, setChecked] = useState(false)
  if (!d.data) return <Loading />
  const after = () => { d.reload(); onChange() }
  const hasInitial = d.data.invoices.some(i => i.type === "awal" && i.status !== "batal")
  // Pratinjau dulu (PRD 8.1): PDF persis seperti yang diterima client, belum bernomor dan tidak disimpan.
  const preview = () => act.run(async () => { await showFile(`/api/admin/projects/${projectId}/invoices/preview`); setChecked(true) })
  const issue = () => act.run(async () => { await api(`/api/admin/projects/${projectId}/invoices`, { body: {} }); setChecked(false); after() },
    "Tagihan awal terbit. Status proyek pindah ke Menunggu Pembayaran.")

  return (
    <>
      {!hasInitial && (
        <div className="card form">
          <h2>Tagihan awal</h2>
          <p className="sub">Tagihan dibuat dari Planning final dan dibayar penuh di depan. Cek pratinjaunya dulu: PDF-nya persis seperti yang diterima client.
            Kalau ada yang salah, kembalikan Planning ke draf lalu ubah di sana.</p>
          <Message msg={act.msg} />
          <div className="actions">
            <button type="button" className="btn" disabled={act.busy} onClick={preview}>Pratinjau tagihan</button>
            <button type="button" className="btn pri" disabled={act.busy || !checked} onClick={issue}>Terbitkan tagihan awal</button>
          </div>
          {!checked && <p className="hint">Tombol terbit aktif setelah pratinjau dibuka.</p>}
        </div>
      )}
      {hasInitial && <Message msg={act.msg} />}
      {d.data.invoices.length === 0 && <p className="sub">Belum ada tagihan.</p>}
      {[...d.data.invoices].reverse().map(i => <InvoiceCard key={i.id} projectId={projectId} inv={i} onChange={after} />)}
    </>
  )
}

function InvoiceCard({ projectId, inv, onChange }: { projectId: string; inv: Invoice; onChange: () => void }) {
  const [paying, setPaying] = useState(false), act = useAction()
  const remaining = inv.total - inv.paid
  const cancel = () => {
    const note = prompt("Alasan pembatalan (boleh kosong):") ?? undefined
    act.run(async () => { await api(`/api/admin/invoices/${inv.id}/cancel`, { body: note ? { note } : {} }); onChange() }, "Tagihan dibatalkan.")
  }
  function pay(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget), proof = f.get("proof") as File
    act.run(async () => {
      const proofId = proof?.size ? (await uploadFile(projectId, "bukti_bayar", proof)).id : null
      const r = await api<{ invoice: Invoice }>(`/api/admin/invoices/${inv.id}/payments`, { body: { amount: Number(f.get("amount")), paid_at: f.get("paid_at"),
        method: f.get("method"), proof_file_id: proofId, note: f.get("note") || null } })
      setPaying(false); onChange()
      return r
    }, "Pembayaran tercatat.")
  }

  return (
    <div className="card form invoice">
      <div className="head">
        <h2>{inv.number} <small>{inv.type === "awal" ? "Tagihan awal" : "Tagihan tambahan"}</small></h2>
        <span className={`pill ${inv.status}`}>{STATUS[inv.status]}</span>
      </div>
      <dl className="info sum">
        <dt>Terbit</dt><dd>{dateText(inv.issued_at)}</dd>
        <dt>Jatuh tempo</dt><dd>{dateText(inv.due_date)}</dd>
        {inv.price_valid_until && <><dt>Harga berlaku sampai</dt><dd>{dateText(inv.price_valid_until)}</dd></>}
        <dt>Total</dt><dd>{rp(inv.total)}</dd>
        <dt>Sudah dibayar</dt><dd>{rp(inv.paid)}</dd>
        {inv.status === "terbit" && <><dt>Sisa</dt><dd>{rp(remaining)}</dd></>}
      </dl>
      {inv.payments.length > 0 && (
        <ul className="plain">
          {inv.payments.map(p => (
            <li key={p.id}>{dateText(p.paid_at)}: {rp(p.amount)} lewat {p.method}
              {p.proof_file_id && <> · <button type="button" className="link" onClick={() => openFile(`/api/files/${p.proof_file_id}`)}>bukti</button></>}</li>
          ))}
        </ul>
      )}
      <Message msg={act.msg} />
      <div className="actions">
        {inv.pdf_file_id && <button type="button" className="btn" onClick={() => openFile(`/api/files/${inv.pdf_file_id}`)}>Unduh PDF</button>}
        {inv.status === "terbit" && !paying && <button type="button" className="btn pri" onClick={() => setPaying(true)}>Catat pembayaran</button>}
        {inv.status === "terbit" && inv.paid === 0 && <button type="button" className="btn danger" disabled={act.busy} onClick={cancel}>Batalkan tagihan</button>}
      </div>
      {paying && (
        <form className="form" onSubmit={pay}>
          <Field label="Jumlah dibayar" name="amount" type="number" min="1" max={remaining} defaultValue={remaining} required />
          <Field label="Tanggal bayar" name="paid_at" type="date" defaultValue={todayWib()} required />
          <Field label="Metode" name="method" defaultValue="Transfer" required />
          <div className="field"><label htmlFor={`proof-${inv.id}`}>Bukti bayar</label><input id={`proof-${inv.id}`} name="proof" type="file" accept="application/pdf,image/jpeg,image/png" /></div>
          <Field label="Catatan" name="note" />
          <div className="actions"><button className="btn pri" disabled={act.busy}>Simpan pembayaran</button><button type="button" className="btn" onClick={() => setPaying(false)}>Batal</button></div>
        </form>
      )}
    </div>
  )
}
