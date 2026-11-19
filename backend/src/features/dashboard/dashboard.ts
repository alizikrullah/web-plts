import { Router } from "express"
import { all, one, pool } from "../../core/db.js"
import { fail } from "../../core/http.js"
import { recap } from "../projects/projects-core.js"
import { getSettings } from "../settings/settings.js"

// Home admin (PRD 5.3). Batas bulan memakai WIB.
export const router = Router()

function monthRange(q: unknown) {
  const m = typeof q === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(q) ? q : fail(400, "month harus YYYY-MM", "INVALID_INPUT")
  const [y, mo] = m.split("-").map(Number)
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`
  return { start: `${m}-01T00:00:00+07:00`, end: `${next}-01T00:00:00+07:00`, startDate: `${m}-01`, endDate: `${next}-01` }
}

// Status Client (Bulanan): status di akhir bulan dihitung dari riwayat (aturan 18.5). Yang masuk daftar adalah proyek
// yang sudah ada di akhir bulan dan belum Selesai atau Ditolak sebelum bulan itu dimulai.
router.get("/admin/home/status-bulanan", async (req, res) => {
  const r = monthRange(req.query.month)
  const status = typeof req.query.status === "string" ? req.query.status : ""
  const rows = await all(pool, `select * from (
      select p.id, p.code, c.name client_name, p.city,
        e.status_id, s.system_key status_key, s.name status_name, ss.name sub_status_name, e.created_at last_update_at, e.note last_update_note,
        (select s2.system_key from status_updates b join project_statuses s2 on s2.id = b.status_id
          where b.project_id = p.id and b.created_at < $1 order by b.created_at desc, b.id desc limit 1) status_before
      from projects p join users c on c.id = p.client_id
      join lateral (select * from status_updates u where u.project_id = p.id and u.created_at < $2 order by u.created_at desc, u.id desc limit 1) e on true
      join project_statuses s on s.id = e.status_id left join project_sub_statuses ss on ss.id = e.sub_status_id
      where p.created_at < $2) x
    where (status_before is null or status_before not in ('selesai', 'ditolak'))
      and ($3 = '' or status_key = $3 or status_id::text = $3)
    order by last_update_at desc`, [r.start, r.end, status])
  res.json({ month: req.query.month, rows: rows.map(({ status_before, ...x }) => x) })
})

// Perlu Tindakan: antrian otomatis, yang paling lama dulu, maksimal 8 baris kecuali ?all=true (PRD 5.3).
router.get("/admin/home/perlu-tindakan", async (req, res) => {
  const s = await getSettings(), t = s.action_thresholds
  const items: { reason: string; label: string; project_id: string | null; code: string | null; client_name: string | null; since: string; detail?: string }[] = []
  const add = (reason: string, label: string, rows: any[], detail?: (r: any) => string) =>
    rows.forEach(r => items.push({ reason, label, project_id: r.id ?? null, code: r.code ?? null, client_name: r.client_name ?? null,
      since: new Date(r.since).toISOString(), ...(detail && { detail: detail(r) }) }))
  const base = `from projects p join users c on c.id = p.client_id join project_statuses s on s.id = p.status_id`

  add("pengajuan_baru", "Pengajuan baru", await all(pool, `select p.id, p.code, c.name client_name, p.submitted_at since ${base} where s.system_key = 'pengajuan'`))
  add("planning_belum_final", "Planning belum final", await all(pool, `select * from (select p.id, p.code, c.name client_name,
      (select max(u.created_at) from status_updates u where u.project_id = p.id and u.status_id = p.status_id) since ${base}
      left join plannings pl on pl.project_id = p.id where s.system_key = 'planning' and coalesce(pl.status, 'draf') = 'draf') x
    where since < now() - $1 * interval '1 day'`, [t.planning_days]))
  add("tagihan_belum_dibayar", "Tagihan belum dibayar", await all(pool, `select p.id, p.code, c.name client_name, i.number,
      least(i.due_date, coalesce(i.price_valid_until, i.due_date))::timestamp at time zone 'Asia/Jakarta' since
    from invoices i join projects p on p.id = i.project_id join users c on c.id = p.client_id
    where i.status = 'terbit' and (i.due_date < (now() at time zone 'Asia/Jakarta')::date or i.price_valid_until < (now() at time zone 'Asia/Jakarta')::date)`),
    r => r.number)
  add("pengerjaan_tanpa_update", "Pengerjaan tanpa update", await all(pool, `select * from (select p.id, p.code, c.name client_name,
      (select max(u.created_at) from status_updates u where u.project_id = p.id) since ${base} where s.system_key = 'on_progress') x
    where since < now() - $1 * interval '1 day'`, [t.no_update_days]))
  add("pembelian_belum_dikonfirmasi", "Pembelian belum dikonfirmasi", await all(pool, `select p.id, p.code, c.name client_name, min(x.created_at) since
    from purchases x join projects p on p.id = x.project_id join users c on c.id = p.client_id where x.status = 'draf' group by p.id, p.code, c.name`))
  // Pembayaran masuk setelah harga berlaku lewat: cek ulang harga sebelum belanja (PRD 8.2 aturan 3).
  add("pembayaran_setelah_harga_berlaku", "Cek ulang harga part", await all(pool, `select p.id, p.code, c.name client_name,
      max(pay.paid_at)::timestamp at time zone 'Asia/Jakarta' since
    from payments pay join invoices i on i.id = pay.invoice_id join projects p on p.id = i.project_id join users c on c.id = p.client_id
    where i.type = 'awal' and i.status <> 'batal' and pay.paid_at > i.price_valid_until
      and not exists (select 1 from purchases x where x.project_id = p.id and x.status = 'terkonfirmasi')
    group by p.id, p.code, c.name`))
  // Rekap per proyek yang sudah punya tagihan awal atau pembelian terkonfirmasi.
  for (const p of await all(pool, `select p.id, p.code, c.name client_name,
      (select max(x.confirmed_at) from purchases x where x.project_id = p.id and x.status = 'terkonfirmasi') last_purchase,
      (select max(x.created_at) from purchases x where x.project_id = p.id) last_any_purchase
    ${base} where s.system_key not in ('selesai', 'ditolak') and exists (select 1 from purchases x where x.project_id = p.id and x.status = 'terkonfirmasi')`)) {
    const r = await recap(pool, p.id)
    if (r.shortfall > 0) add("belanja_melebihi_tagihan", "Belanja melebihi tagihan", [{ ...p, since: p.last_purchase }], () => `Kurang Rp${r.shortfall.toLocaleString("id-ID")}`)
    if (r.refund_remaining > 0 && Date.parse(p.last_any_purchase) < Date.now() - t.refund_days * 86400e3)
      add("pengembalian_belum_dicatat", "Pengembalian belum dicatat", [{ ...p, since: p.last_purchase }], () => `Sisa Rp${r.refund_remaining.toLocaleString("id-ID")}`)
  }
  const stale = await one(pool, `select count(*)::int n, min(price_updated_at) since from parts where is_active and price_updated_at < now() - $1 * interval '1 day'`, [t.stale_price_days])
  if (stale!.n > 0) add("harga_part_kedaluwarsa", "Harga part kedaluwarsa", [{ since: stale!.since }], () => `${stale!.n} part`)

  items.sort((a, b) => a.since.localeCompare(b.since))
  res.json({ total: items.length, items: req.query.all === "true" ? items : items.slice(0, 8),
    ...(items.length === 0 && { message: "Semua beres, tidak ada yang perlu ditindak." }) })
})

// Tagihan dan Pembayaran untuk bulan terpilih, ditambah tagihan lewat jatuh tempo dari semua bulan (PRD 5.3).
router.get("/admin/home/tagihan", async (req, res) => {
  const r = monthRange(req.query.month)
  const month = (await one(pool, `select coalesce(sum(i.total), 0)::bigint billed,
      coalesce(sum((select coalesce(sum(amount), 0) from payments pay where pay.invoice_id = i.id)), 0)::bigint paid
    from invoices i where i.status in ('terbit', 'lunas') and i.issued_at >= $1 and i.issued_at < $2`, [r.start, r.end]))!
  const overdue = (await one(pool, `select count(*)::int count, coalesce(sum(i.total - (select coalesce(sum(amount), 0) from payments pay where pay.invoice_id = i.id)), 0)::bigint amount
    from invoices i where i.status = 'terbit' and i.due_date < (now() at time zone 'Asia/Jakarta')::date`))!
  res.json({ month: req.query.month, billed: month.billed, paid: month.paid, unpaid: month.billed - month.paid, overdue })
})
