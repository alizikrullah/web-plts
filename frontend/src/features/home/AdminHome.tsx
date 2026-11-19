import { useState } from "react"
import { Link } from "react-router"
import { rp } from "../../../../shared/format"
import type { User } from "../../core/api"
import { dateText, todayWib, useApi } from "../../core/useApi"

interface Row { id: string; code: string; client_name: string; city: string; status_key: string; status_name: string; sub_status_name: string | null; last_update_at: string; last_update_note: string | null }
interface Item { reason: string; label: string; project_id: string | null; code: string | null; client_name: string | null; since: string; detail?: string }

// Tombol tiap alasan Perlu Tindakan (PRD 5.3) membuka bagian proyek yang perlu dikerjakan.
const project = (tab: string) => (i: Item) => `/client/${i.project_id}${tab ? `?tab=${tab}` : ""}`
const ACTION: Record<string, [string, (i: Item) => string]> = {
  pengajuan_baru: ["Tinjau dan terima", project("")],
  planning_belum_final: ["Buka planning", project("planning")],
  tagihan_belum_dibayar: ["Lihat tagihan", project("penagihan")],
  pembayaran_setelah_harga_berlaku: ["Cek harga part", project("planning")],
  pengerjaan_tanpa_update: ["Update status", project("status")],
  belanja_melebihi_tagihan: ["Buat Biaya Tambahan", project("pembelian")],
  pembelian_belum_dikonfirmasi: ["Cek dan konfirmasi", project("pembelian")],
  pengembalian_belum_dicatat: ["Catat pengembalian", project("pembelian")],
  harga_part_kedaluwarsa: ["Perbarui harga", () => "/list-part"],
}

// Dashboard admin (PRD 5.3).
export default function AdminHome({ user }: { user: User }) {
  const [month, setMonth] = useState(todayWib().slice(0, 7)), [status, setStatus] = useState(""), [all, setAll] = useState(false)
  const statuses = useApi<{ statuses: { id: string; system_key: string | null; name: string }[] }>("/api/admin/statuses")
  const rows = useApi<{ rows: Row[] }>(`/api/admin/home/status-bulanan?month=${month}${status ? `&status=${status}` : ""}`)
  const todo = useApi<{ total: number; items: Item[]; message?: string }>(`/api/admin/home/perlu-tindakan${all ? "?all=true" : ""}`)
  const bills = useApi<{ billed: number; paid: number; unpaid: number; overdue: { count: number; amount: number } }>(`/api/admin/home/tagihan?month=${month}`)

  return (
    <section className="wrap page">
      <div className="card">
        <h1>Halo, {user.name}</h1>
        <div className="actions three">
          <Link className="btn pri" to="/client/baru">Client atau proyek baru</Link>
          <Link className="btn" to="/client?status=planning">Buat tagihan</Link>
          <Link className="btn" to="/list-part">Perbarui harga part</Link>
        </div>
      </div>

      <div className="card">
        <div className="head">
          <h2>Status Client (Bulanan)</h2>
          <div className="filters">
            <label>Bulan <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
            <label>Status <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">Semua</option>
              {statuses.data?.statuses.map(s => <option key={s.id} value={s.system_key ?? s.id}>{s.name}</option>)}
            </select></label>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Client</th><th>Kota</th><th>Status</th><th>Update terakhir</th><th /></tr></thead>
            <tbody>
              {rows.data?.rows.map(r => (
                <tr key={r.id}>
                  <td>{r.client_name}<small>{r.code}</small></td>
                  <td>{r.city}</td>
                  <td>{r.status_name}{r.sub_status_name && <small>{r.sub_status_name}</small>}</td>
                  <td>{dateText(r.last_update_at)}{r.last_update_note && <small>{r.last_update_note}</small>}</td>
                  <td><Link className="btn sm" to={`/client/${r.id}`}>Buka</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.data?.rows.length === 0 && <p className="sub">Belum ada proyek di bulan ini.</p>}
        </div>
      </div>

      <div className="card">
        <h2>Perlu Tindakan</h2>
        {todo.data && todo.data.items.length === 0 && <p className="sub">{todo.data.message ?? "Semua beres, tidak ada yang perlu ditindak."}</p>}
        <ul className="todo">
          {todo.data?.items.map((i, n) => {
            const [label, to] = ACTION[i.reason] ?? ["Buka", project("")]
            return (
              <li key={n}>
                <div><b>{i.label}</b><span>{[i.code, i.client_name, i.detail].filter(Boolean).join(" · ")}</span><small>Sejak {dateText(i.since)}</small></div>
                <Link className="btn" to={to(i)}>{label}</Link>
              </li>
            )
          })}
        </ul>
        {todo.data && !all && todo.data.total > todo.data.items.length && <button type="button" className="btn" onClick={() => setAll(true)}>Lihat semua ({todo.data.total})</button>}
      </div>

      <div className="card">
        <h2>Tagihan dan Pembayaran</h2>
        {bills.data && (
          <>
            <dl className="stats three">
              <div><dt>Total ditagih</dt><dd>{rp(bills.data.billed)}</dd></div>
              <div><dt>Sudah dibayar</dt><dd>{rp(bills.data.paid)}</dd></div>
              <div><dt>Belum dibayar</dt><dd>{rp(bills.data.unpaid)}</dd></div>
            </dl>
            {bills.data.overdue.count > 0 && <p className="msg bad">{bills.data.overdue.count} tagihan lewat jatuh tempo, belum dibayar {rp(bills.data.overdue.amount)}.</p>}
          </>
        )}
      </div>
    </section>
  )
}
