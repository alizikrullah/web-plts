import { useId, useState, type InputHTMLAttributes } from "react"
import { Link } from "react-router"

export function Loading() {
  return <p className="loading" role="status">Memuat...</p>
}

export function Field({ label, hint, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="box"><input id={id} {...input} /></div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

// Halaman yang dibuat di tahap berikutnya. Rutenya sudah ada supaya menu dan penjaga rute bisa diuji sejak F1.
export function Placeholder({ title, stage }: { title: string; stage: string }) {
  return (
    <section className="wrap page">
      <div className="card"><h1>{title}</h1><p className="sub">Halaman ini dikerjakan di tahap {stage}.</p></div>
    </section>
  )
}

export function NotFound() {
  return (
    <section className="wrap page">
      <div className="card"><h1>Halaman tidak ditemukan</h1><p className="sub"><Link to="/">Kembali ke Home</Link></p></div>
    </section>
  )
}

// Link chat WhatsApp dengan pesan terisi.
export const waLink = (number: string, text: string) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`

// Menjalankan aksi ke backend dengan pesan berhasil atau gagal di dekat tombolnya.
export type Msg = { ok: boolean; text: string } | null
export function useAction() {
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<Msg>(null)
  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true); setMsg(null)
    try { await fn(); if (done) setMsg({ ok: true, text: done }) } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  return { run, busy, msg, setMsg }
}
export const Message = ({ msg }: { msg: Msg }) => msg && <p className={msg.ok ? "msg ok" : "msg bad"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>
