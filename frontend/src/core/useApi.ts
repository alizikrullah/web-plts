import { useEffect, useState } from "react"
import { api } from "./api"

// Memuat data dari backend untuk satu halaman. Data lama tetap tampil selama dimuat ulang. path null = belum perlu dimuat.
export function useApi<T>(path: string | null) {
  const [state, set] = useState<{ data?: T; error?: string }>({})
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!path) return
    let live = true
    api<T>(path).then(data => { if (live) set({ data }) }, e => { if (live) set(s => ({ data: s.data, error: e.message })) })
    return () => { live = false }
  }, [path, n])
  return { ...state, reload: () => setN(x => x + 1) }
}

// Waktu disimpan dalam UTC dan ditampilkan dalam WIB (PRD bagian 12).
export const dateText = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? d + "T00:00:00+07:00" : d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }) : "-"
export const dateTimeText = (d: string) =>
  new Date(d).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })
export const daysAgo = (d: string) => {
  const n = Math.floor((Date.now() - Date.parse(d)) / 86400e3)
  return n <= 0 ? "hari ini" : `${n} hari lalu`
}
// Tanggal hari ini dan bulan ini menurut WIB, misalnya untuk isian tanggal bayar dan pemilih bulan.
export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
