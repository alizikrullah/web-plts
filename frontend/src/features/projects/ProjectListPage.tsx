import { useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router"
import { dateText, useApi } from "../../core/useApi"

interface Row { id: string; code: string; name: string; city: string; client_name: string; status_key: string | null; status_name: string; sub_status_name: string | null; pic_name: string | null; last_update_at: string | null }
export interface Status { id: string; system_key: string | null; name: string; is_active: boolean; show_to_client: boolean; sort_order: number; sub_statuses: { id: string; name: string; is_active: boolean; sort_order: number }[] }

// Daftar proyek untuk admin (PRD 7.1): bisa dicari dan difilter per status.
export default function ProjectListPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get("q") ?? "", status = params.get("status") ?? ""
  const [text, setText] = useState(q)
  const statuses = useApi<{ statuses: Status[] }>("/api/admin/statuses")
  const list = useApi<{ projects: Row[] }>(`/api/admin/projects?q=${encodeURIComponent(q)}&status=${status}`)
  const set = (k: string, v: string) => setParams(p => { if (v) p.set(k, v); else p.delete(k); return p }, { replace: true })
  const search = (e: FormEvent) => { e.preventDefault(); set("q", text.trim()) }

  return (
    <section className="wrap page">
      <div className="head">
        <h1>Client</h1>
        <Link className="btn pri" to="/client/baru">Client atau proyek baru</Link>
      </div>
      <div className="card">
        <form className="filters" onSubmit={search}>
          <label>Cari <input type="search" value={text} onChange={e => setText(e.target.value)} placeholder="Kode, nama client, atau kota" /></label>
          <label>Status <select value={status} onChange={e => set("status", e.target.value)}>
            <option value="">Semua</option>
            {statuses.data?.statuses.map(s => <option key={s.id} value={s.system_key ?? s.id}>{s.name}</option>)}
          </select></label>
          <button className="btn">Cari</button>
        </form>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Kode</th><th>Client</th><th>Kota</th><th>Status</th><th>Update terakhir</th><th>Penanggung jawab</th><th /></tr></thead>
            <tbody>
              {list.data?.projects.map(p => (
                <tr key={p.id}>
                  <td>{p.code}<small>{p.name}</small></td>
                  <td>{p.client_name}</td>
                  <td>{p.city}</td>
                  <td>{p.status_name}{p.sub_status_name && <small>{p.sub_status_name}</small>}</td>
                  <td>{dateText(p.last_update_at)}</td>
                  <td>{p.pic_name ?? "-"}</td>
                  <td><Link className="btn sm" to={`/client/${p.id}`}>Buka</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data?.projects.length === 0 && <p className="sub">Tidak ada proyek yang cocok.</p>}
        </div>
      </div>
    </section>
  )
}
