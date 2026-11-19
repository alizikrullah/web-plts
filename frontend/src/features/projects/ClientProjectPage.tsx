import { useSearchParams } from "react-router"
import type { ProjectSummary } from "../../core/types"
import { Loading } from "../../core/ui"
import { useApi } from "../../core/useApi"
import PurchasesTab from "../purchases/PurchasesTab"
import StatusTab from "../status/StatusTab"

// Halaman client (PRD 7.2 dan 19.2 F5): Status Pengerjaan dan Invoice Pembelian proyek sendiri, hanya melihat.
// Backend hanya mengirim proyek milik client yang masuk (aturan 18.1); admin melihat semua proyek.
export default function ClientProjectPage({ view }: { view: "status" | "pembelian" }) {
  const [params, setParams] = useSearchParams()
  const list = useApi<{ projects: ProjectSummary[] }>("/api/projects")
  if (!list.data) return <Loading />
  const projects = list.data.projects.filter(p => !["pengajuan", "ditolak"].includes(p.status_key))
  const p = projects.find(x => x.id === params.get("proyek")) ?? projects[0]
  const title = view === "status" ? "Status Pengerjaan" : "Invoice Pembelian"
  return (
    <section className="wrap page">
      <h1>{title}</h1>
      {projects.length > 1 && (
        <div className="field"><label htmlFor="proyek">Proyek</label>
          <div className="box"><select id="proyek" value={p.id} onChange={e => setParams({ proyek: e.target.value }, { replace: true })}>
            {projects.map(x => <option key={x.id} value={x.id}>{x.code}, {x.name}</option>)}
          </select></div></div>
      )}
      {!p ? <p className="sub">Belum ada proyek.</p>
        : view === "status" ? <StatusTab key={p.id} projectId={p.id} /> : <PurchasesTab key={p.id} projectId={p.id} />}
    </section>
  )
}
