import { Router } from "express"
import { createAccount } from "../accounts/accounts.js"
import { all, one, pool, tx } from "../../core/db.js"
import { allow, auth, fail, param, v } from "../../core/http.js"
import { createPlanning } from "../planning/planning-core.js"
import { finishBlockers, moveTo, nextNumber, projectFor, readLocation, recap, setStatus, statusByKey, statusKeyOf } from "./projects-core.js"
import { getSettings } from "../settings/settings.js"
import { withAdvice } from "../simulations/simulations.js"

// B5: pengajuan, proyek, status, dan data Home (PRD bagian 3, 5, 7, 9).
export const router = Router()

// Ajukan perhitungan detail (PRD 6.5). Simulasi yang diajukan dikunci; konfigurasi berlabel Bahaya tidak bisa diajukan.
router.post("/simulations/:id/submit", auth, allow("guest", "client"), async (req, res) => {
  const b = req.body ?? {}
  const address = v.text(b, "address"), city = v.str(b, "city"), note = v.optText(b, "request_note"), loc = readLocation(b)
  const project = await tx(async c => {
    await c.query("select pg_advisory_xact_lock(hashtext($1))", ["submit:" + req.user!.sub])
    const sim = await one(c, "select * from simulations where id = $1 and user_id = $2 for update", [param(req, "id"), req.user!.sub])
      ?? fail(404, "Simulasi tidak ditemukan", "NOT_FOUND")
    if (sim.is_locked) fail(409, "Simulasi ini sudah pernah diajukan. Hitung ulang untuk pengajuan baru.", "ALREADY_SUBMITTED")
    if (withAdvice(sim).danger) fail(400, "Konfigurasi ini punya saran berlabel Bahaya dan tidak bisa diajukan", "DANGER")
    // Satu akun hanya boleh punya satu pengajuan yang masih menunggu keputusan admin.
    if (await one(c, `select 1 from projects p join project_statuses s on s.id = p.status_id where p.client_id = $1 and s.system_key = 'pengajuan'`, [req.user!.sub]))
      fail(409, "Masih ada pengajuan yang sedang ditinjau", "PENDING_SUBMISSION")
    const status = await statusByKey(c, "pengajuan")
    const code = await nextNumber(c, "projects", "code", "PLTS")
    const name = `PLTS ${Number(sim.capacity_kwp).toLocaleString("id-ID", { maximumFractionDigits: 2 })} kWp`
    const p = (await one(c, `insert into projects (code, name, client_id, simulation_id, status_id, address, city, request_note, latitude, longitude, submitted_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()) returning *`, [code, name, req.user!.sub, sim.id, status.id, address, city, note, loc.latitude, loc.longitude]))!
    await c.query("update simulations set is_locked = true where id = $1", [sim.id])
    await c.query("insert into status_updates (project_id, status_id, note, created_by) values ($1, $2, $3, $4)", [p.id, status.id, note, req.user!.sub])
    return p
  })
  res.status(201).json({ project })
})

// Angka bukti di Home: hanya kalau proyek selesai minimal sesuai Pengaturan (PRD 5.1).
router.get("/home/stats", async (_req, res) => {
  const s = await getSettings()
  const r = (await one(pool, `select count(*)::int finished, coalesce(sum(installed_kwp), 0) kwp from projects p
    join project_statuses st on st.id = p.status_id where st.system_key = 'selesai'`))!
  res.json(r.finished >= s.proof_min_finished ? { show: true, finished_projects: r.finished, installed_kwp: r.kwp } : { show: false })
})

// Ringkasan proyek untuk Home dan halaman client.
const SUMMARY = `select p.id, p.code, p.name, p.address, p.city, p.estimated_finish_date, p.submitted_at, p.accepted_at, p.finished_at, p.rejected_reason,
  s.system_key status_key, s.name status_name, ss.name sub_status_name,
  (select json_build_object('note', u.note, 'at', u.created_at) from status_updates u where u.project_id = p.id order by u.created_at desc limit 1) last_update,
  (select json_build_object('name', a.name, 'whatsapp', a.whatsapp) from users a where a.id = p.pic_admin_id) pic,
  (select json_build_object('number', i.number, 'status', i.status, 'total', i.total, 'due_date', i.due_date, 'price_valid_until', i.price_valid_until)
    from invoices i where i.project_id = p.id and i.type = 'awal' and i.status in ('terbit', 'lunas')) initial_invoice,
  (select json_build_object('count', count(*), 'total_paid', coalesce(sum(total_paid), 0), 'last_date', max(purchase_date))
    from purchases x where x.project_id = p.id and x.status = 'terkonfirmasi') purchases,
  (select json_build_object('capacity_kwp', m.capacity_kwp, 'panel_qty', m.panel_qty, 'daily_production_kwh', m.daily_production_kwh,
    'monthly_saving', m.monthly_saving, 'bep_years', m.bep_years, 'est_investment', m.est_investment) from simulations m where m.id = p.simulation_id) simulation,
  (select json_agg(json_build_object('status_key', st.system_key, 'name', st.name, 'entered_at',
      (select min(u.created_at) from status_updates u where u.project_id = p.id and u.status_id = st.id)) order by st.sort_order)
    from project_statuses st where st.show_to_client and st.is_active) stages
  from projects p join project_statuses s on s.id = p.status_id left join project_sub_statuses ss on ss.id = p.sub_status_id`

// Data Home untuk guest dan client (PRD 5.1 dan 5.2). Guest hanya boleh membaca status dan alasan penolakan pengajuannya.
router.get("/home", auth, allow("guest", "client"), async (req, res) => {
  const simulation = await one(pool, `select id, created_at, is_locked, monthly_saving, bep_years, est_investment, capacity_kwp
    from simulations where user_id = $1 order by created_at desc limit 1`, [req.user!.sub])
  const projects = req.user!.role === "client"
    ? await all(pool, `${SUMMARY} where p.client_id = $1 order by p.created_at desc`, [req.user!.sub])
    : await all(pool, `select p.id, p.code, s.system_key status_key, p.rejected_reason, p.submitted_at from projects p
        join project_statuses s on s.id = p.status_id where p.client_id = $1 order by p.created_at desc`, [req.user!.sub])
  res.json({ simulation: simulation ?? null, projects })
})

// Halaman client: daftar proyek sendiri dan Status Pengerjaan (PRD 9.4).
router.get("/projects", async (req, res) => {
  res.json({ projects: await all(pool, `${SUMMARY} where ($1 or p.client_id = $2) order by p.created_at desc`, [req.user!.role === "admin", req.user!.sub]) })
})

router.get("/projects/:id/status", async (req, res) => {
  const p = await projectFor(pool, req, param(req, "id"))
  const project = await one(pool, `${SUMMARY} where p.id = $1`, [p.id])
  const history = await all(pool, `select u.id, u.created_at, u.note, s.name status_name, ss.name sub_status_name, a.name by_name,
    coalesce((select json_agg(f.file_id) from status_update_photos f where f.status_update_id = u.id), '[]') photo_file_ids
    from status_updates u join project_statuses s on s.id = u.status_id left join project_sub_statuses ss on ss.id = u.sub_status_id
    join users a on a.id = u.created_by where u.project_id = $1 order by u.created_at desc`, [p.id])
  const invoices = await all(pool, `select id, type, number, status, issued_at, due_date, price_valid_until, total, pdf_file_id
    from invoices where project_id = $1 and status in ('terbit', 'lunas') order by issued_at`, [p.id])
  res.json({ project, history, invoices })
})

// ---------- Admin ----------

router.get("/admin/projects", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : ""
  const status = typeof req.query.status === "string" ? req.query.status : ""
  res.json({ projects: await all(pool, `select p.id, p.code, p.name, p.city, c.name client_name, s.id status_id, s.system_key status_key, s.name status_name,
      ss.name sub_status_name, a.name pic_name,
      (select max(u.created_at) from status_updates u where u.project_id = p.id) last_update_at
    from projects p join users c on c.id = p.client_id join project_statuses s on s.id = p.status_id
    left join project_sub_statuses ss on ss.id = p.sub_status_id left join users a on a.id = p.pic_admin_id
    where ($1 = '' or p.code ilike '%' || $1 || '%' or c.name ilike '%' || $1 || '%' or p.city ilike '%' || $1 || '%')
      and ($2 = '' or s.system_key = $2 or s.id::text = $2)
    order by p.created_at desc`, [q, status]) })
})

// Client atau proyek baru untuk client yang datang lewat WhatsApp: langsung di status Planning (PRD 7.1).
router.post("/admin/projects", async (req, res) => {
  const b = req.body ?? {}
  const out = await tx(async c => {
    let clientId: string, temporary_password: string | undefined
    if (b.client_id !== undefined) {
      clientId = v.uuid(b, "client_id")
      const u = await one(c, "select role from users where id = $1 and is_active", [clientId]) ?? fail(400, "Client tidak ditemukan", "INVALID_INPUT")
      if (u.role === "admin") fail(400, "Akun admin tidak bisa menjadi client", "INVALID_INPUT")
      await c.query("update users set role = 'client', became_client_at = coalesce(became_client_at, now()) where id = $1", [clientId])
    } else {
      const acc = await createAccount(c, (b.client ?? {}) as Record<string, unknown>, "client")
      clientId = acc.user.id; temporary_password = acc.temporary_password
    }
    const status = await statusByKey(c, "planning")
    const code = await nextNumber(c, "projects", "code", "PLTS")
    const loc = readLocation(b)
    const p = (await one(c, `insert into projects (code, name, client_id, pic_admin_id, status_id, address, city, request_note, latitude, longitude, accepted_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()) returning *`,
      [code, v.str(b, "name"), clientId, req.user!.sub, status.id, v.text(b, "address"), v.str(b, "city"), v.optText(b, "request_note"), loc.latitude, loc.longitude]))!
    await c.query("insert into status_updates (project_id, status_id, note, created_by) values ($1, $2, $3, $4)", [p.id, status.id, "Proyek dibuat admin", req.user!.sub])
    await createPlanning(c, p, req.user!.sub)
    return { project: p, ...(temporary_password && { temporary_password }) }
  })
  res.status(201).json(out)
})

router.get("/admin/projects/:id", async (req, res) => {
  const p = await projectFor(pool, req, param(req, "id"))
  const project = await one(pool, `${SUMMARY} where p.id = $1`, [p.id])
  const client = await one(pool, "select id, name, email, whatsapp, role, is_active from users where id = $1", [p.client_id])
  const sim = p.simulation_id ? await one(pool, "select * from simulations where id = $1", [p.simulation_id]) : null
  res.json({ project: { ...project, pic_admin_id: p.pic_admin_id, request_note: p.request_note, installed_kwp: p.installed_kwp, latitude: p.latitude, longitude: p.longitude },
    client, simulation: sim && withAdvice(sim), recap: await recap(pool, p.id),
    warnings: await projectWarnings(p.id) })
})

// Peringatan pembayaran setelah masa berlaku harga lewat (PRD 8.2 aturan 3). Tidak mengunci proyek.
export async function projectWarnings(projectId: string) {
  const late = await one(pool, `select max(pay.paid_at) paid_at, i.price_valid_until from payments pay join invoices i on i.id = pay.invoice_id
    where i.project_id = $1 and i.type = 'awal' and i.status <> 'batal' and pay.paid_at > i.price_valid_until group by i.price_valid_until`, [projectId])
  return late ? [`Pembayaran masuk ${late.paid_at}, setelah harga berlaku sampai ${late.price_valid_until}. Cek ulang harga part sebelum belanja.`] : []
}

router.patch("/admin/projects/:id", async (req, res) => {
  const p = await projectFor(pool, req, param(req, "id")), b = req.body ?? {}
  const m = { ...p, ...b }
  const pic = v.optUuid(m, "pic_admin_id")
  if (pic && !(await one(pool, "select 1 from users where id = $1 and role = 'admin' and is_active", [pic]))) fail(400, "Penanggung jawab harus admin aktif", "INVALID_INPUT")
  const kwp = v.optNum(m, "installed_kwp", 0)
  const loc = readLocation(m)
  const project = await one(pool, `update projects set name = $2, address = $3, city = $4, pic_admin_id = $5, estimated_finish_date = $6, installed_kwp = $7,
    latitude = $8, longitude = $9 where id = $1 returning *`, [p.id, v.str(m, "name"), v.text(m, "address"), v.str(m, "city"), pic, v.optDate(m, "estimated_finish_date"), kwp,
    loc.latitude, loc.longitude])
  res.json({ project })
})

// Terima pengajuan: role guest naik menjadi client dan proyek pindah ke Planning sekaligus (PRD bagian 2 aturan 2, 7.3).
router.post("/admin/projects/:id/accept", async (req, res) => {
  const project = await tx(async c => {
    const p = await projectFor(c, req, param(req, "id"), true)
    if ((await statusKeyOf(c, p)) !== "pengajuan") fail(409, "Hanya proyek berstatus Pengajuan yang bisa diterima", "INVALID_STATUS")
    await c.query("update users set role = 'client', became_client_at = coalesce(became_client_at, now()) where id = $1 and role = 'guest'", [p.client_id])
    await c.query("update projects set accepted_at = now(), pic_admin_id = $2 where id = $1", [p.id, req.user!.sub])
    await moveTo(c, p.id, "planning", v.optText(req.body ?? {}, "note") ?? "Pengajuan diterima", req.user!.sub)
    await createPlanning(c, p, req.user!.sub)
    return one(c, "select * from projects where id = $1", [p.id])
  })
  res.json({ project })
})

// Tolak pengajuan: wajib dengan alasan, guest tetap guest dan boleh mengajukan lagi (PRD 7.3).
router.post("/admin/projects/:id/reject", async (req, res) => {
  const reason = v.text(req.body ?? {}, "reason")
  const project = await tx(async c => {
    const p = await projectFor(c, req, param(req, "id"), true)
    if ((await statusKeyOf(c, p)) !== "pengajuan") fail(409, "Hanya proyek berstatus Pengajuan yang bisa ditolak", "INVALID_STATUS")
    await c.query("update projects set rejected_reason = $2 where id = $1", [p.id, reason])
    await moveTo(c, p.id, "ditolak", reason, req.user!.sub)
    return one(c, "select * from projects where id = $1", [p.id])
  })
  res.json({ project })
})

// Update status oleh admin: ganti status atau sub-status, catatan, dan foto. Bisa juga hanya catatan dan foto (PRD 9.3).
router.post("/admin/projects/:id/status-updates", async (req, res) => {
  const b = req.body ?? {}
  const update = await tx(async c => {
    const p = await projectFor(c, req, param(req, "id"), true)
    const statusId = v.optUuid(b, "status_id") ?? p.status_id
    const subId = b.sub_status_id !== undefined ? v.optUuid(b, "sub_status_id") : statusId === p.status_id ? p.sub_status_id : null
    const note = v.optText(b, "note")
    const raw = b.photo_file_ids ?? []
    if (!Array.isArray(raw)) fail(400, "photo_file_ids harus daftar", "INVALID_INPUT")
    const photos = [...new Set((raw as unknown[]).map(id => v.uuid({ photo_file_ids: id }, "photo_file_ids")))]
    const status = await one(c, "select * from project_statuses where id = $1", [statusId]) ?? fail(400, "Status tidak ditemukan", "INVALID_INPUT")
    if (statusId !== p.status_id) {
      if (!status.is_active) fail(400, "Status ini sudah nonaktif", "INVALID_INPUT")
      if (!note) fail(400, "Pindah status manual wajib dengan catatan", "INVALID_INPUT")
      if (status.system_key === "selesai") {
        const reasons = await finishBlockers(c, p.id)
        if (reasons.length) fail(409, "Proyek belum bisa ditandai Selesai: " + reasons.join("; "), "CANNOT_FINISH")
        // kWp terpasang diisi otomatis dari Planning (jumlah panel x Wp) kalau belum diisi admin
        await c.query(`update projects set finished_at = now(), installed_kwp = coalesce(installed_kwp,
          (select sum(i.qty * pt.wp) / 1000 from plannings pl join planning_items i on i.planning_id = pl.id join parts pt on pt.id = i.part_id
            where pl.project_id = $1 and pt.category = 'panel')) where id = $1`, [p.id])
      }
    }
    if (subId && !(await one(c, "select 1 from project_sub_statuses where id = $1 and status_id = $2 and is_active", [subId, statusId])))
      fail(400, "Sub-status tidak sesuai status utamanya", "INVALID_INPUT")
    if (!note && !photos.length && statusId === p.status_id && subId === p.sub_status_id) fail(400, "Isi catatan, foto, atau status baru", "INVALID_INPUT")
    for (const id of photos)
      if (!(await one(c, "select 1 from files where id = $1 and project_id = $2 and purpose = 'foto_status'", [id, p.id])))
        fail(400, "Foto harus diunggah ke proyek ini dengan purpose foto_status", "INVALID_INPUT")
    const u = (await setStatus(c, p.id, statusId, subId, note, req.user!.sub))!
    for (const id of photos) await c.query("insert into status_update_photos (status_update_id, file_id) values ($1, $2)", [u.id, id])
    return { ...u, photo_file_ids: photos }
  })
  res.status(201).json({ status_update: update })
})
