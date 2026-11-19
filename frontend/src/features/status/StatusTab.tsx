import { useEffect, useState, type FormEvent } from "react"
import { rp } from "../../../../shared/format"
import { api, fileBlob, openFile, uploadFile } from "../../core/api"
import type { ProjectSummary } from "../../core/types"
import { Loading, Message, useAction } from "../../core/ui"
import { dateText, dateTimeText, useApi } from "../../core/useApi"
import { ProjectCard } from "../home/ClientHome"
import type { Status } from "../projects/ProjectListPage"

interface History { id: string; created_at: string; note: string | null; status_name: string; sub_status_name: string | null; by_name: string; photo_file_ids: string[] }
interface Invoice { id: string; type: string; number: string; status: string; issued_at: string; due_date: string; total: number; pdf_file_id: string | null }

// Foto dari backend setelah cek pemilik, ditampilkan dari memori browser.
function Photo({ id }: { id: string }) {
  const [src, setSrc] = useState("")
  useEffect(() => {
    let url = ""
    fileBlob(`/api/files/${id}`).then(b => { url = URL.createObjectURL(b); setSrc(url) }, () => {})
    return () => URL.revokeObjectURL(url)
  }, [id])
  return <button type="button" className="photo" onClick={() => openFile(`/api/files/${id}`)} aria-label="Buka foto">{src && <img src={src} alt="Foto proses" />}</button>
}

// Status Pengerjaan (PRD bagian 9). Admin mengisi, client hanya melihat.
export default function StatusTab({ projectId, admin = false, onChange }: { projectId: string; admin?: boolean; onChange?: () => void }) {
  const d = useApi<{ project: ProjectSummary; history: History[]; invoices: Invoice[] }>(`/api/projects/${projectId}/status`)
  if (!d.data) return <Loading />
  const { project: p, history, invoices } = d.data
  return (
    <>
      <ProjectCard p={p} />
      {admin && <UpdateForm projectId={projectId} current={p} onDone={() => { d.reload(); onChange?.() }} />}
      {invoices.length > 0 && (
        <div className="card">
          <h2>Tagihan</h2>
          <ul className="plain">
            {invoices.map(i => (
              <li key={i.id} className="row">
                <span><b>{i.number}</b> {i.type === "awal" ? "tagihan awal" : "tagihan tambahan"}, {rp(i.total)}, {i.status === "lunas" ? "lunas" : `jatuh tempo ${dateText(i.due_date)}`}</span>
                {i.pdf_file_id && <button type="button" className="btn sm" onClick={() => openFile(`/api/files/${i.pdf_file_id}`)}>Unduh PDF</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="card">
        <h2>Riwayat</h2>
        <ol className="history">
          {history.map(h => (
            <li key={h.id}>
              <small>{dateTimeText(h.created_at)}{admin && ` · ${h.by_name}`}</small>
              <b>{h.status_name}{h.sub_status_name && `, ${h.sub_status_name}`}</b>
              {h.note && <p className="pre">{h.note}</p>}
              {h.photo_file_ids.length > 0 && <div className="photos">{h.photo_file_ids.map(id => <Photo key={id} id={id} />)}</div>}
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}

// Update status oleh admin (PRD 9.3): status dan sub-status, catatan, foto. Pindah status manual wajib dengan catatan.
function UpdateForm({ projectId, current, onDone }: { projectId: string; current: ProjectSummary; onDone: () => void }) {
  const statuses = useApi<{ statuses: Status[] }>("/api/admin/statuses")
  const now = statuses.data?.statuses.find(s => (current.status_key && s.system_key === current.status_key) || s.name === current.status_name)
  const [statusId, setStatusId] = useState(""), act = useAction()
  const chosen = statuses.data?.statuses.find(s => s.id === (statusId || now?.id))
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget, f = new FormData(form), files = (f.getAll("photos") as File[]).filter(x => x.size)
    act.run(async () => {
      const ids = []
      for (const file of files) ids.push((await uploadFile(projectId, "foto_status", file)).id)
      await api(`/api/admin/projects/${projectId}/status-updates`, { body: { status_id: chosen?.id, sub_status_id: (f.get("sub_status_id") as string) || null,
        note: (f.get("note") as string) || null, photo_file_ids: ids } })
      form.reset(); setStatusId(""); onDone()
    }, "Update status tersimpan.")
  }
  if (!statuses.data) return null
  return (
    <form className="card form" onSubmit={submit}>
      <h2>Update status</h2>
      <div className="field"><label htmlFor="status-id">Status</label>
        <div className="box"><select id="status-id" value={chosen?.id ?? ""} onChange={e => setStatusId(e.target.value)}>
          {statuses.data.statuses.filter(s => s.is_active || s.id === now?.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></div></div>
      {!!chosen?.sub_statuses.length && (
        <div className="field"><label htmlFor="sub-status-id">Sub-status</label>
          <div className="box"><select id="sub-status-id" name="sub_status_id" key={chosen.id}
            defaultValue={chosen.id === now?.id ? chosen.sub_statuses.find(x => x.name === current.sub_status_name)?.id ?? "" : ""}>
            <option value="">Tanpa sub-status</option>
            {chosen.sub_statuses.filter(x => x.is_active).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></div></div>
      )}
      <div className="field"><label htmlFor="status-note">Catatan</label><textarea id="status-note" name="note" rows={3} /></div>
      <div className="field"><label htmlFor="status-photos">Foto proses</label><input id="status-photos" name="photos" type="file" accept="image/jpeg,image/png" multiple /></div>
      <p className="hint">Boleh hanya catatan atau foto tanpa mengganti status. Pindah status wajib dengan catatan.</p>
      <Message msg={act.msg} />
      <button className="btn pri" disabled={act.busy}>Simpan update</button>
    </form>
  )
}
