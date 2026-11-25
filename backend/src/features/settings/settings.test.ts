import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { one, pool } from "../../core/db.js"
import { client, freshTestDb, startApp, userSession, type Session } from "../../test/test-db.js"
import { seedDefaults } from "./settings-defaults.js"
import { SETTINGS } from "./settings.js"

let app: Awaited<ReturnType<typeof startApp>>, call: ReturnType<typeof client>, admin: Session
beforeAll(async () => {
  await freshTestDb(); await seedDefaults(pool)
  app = await startApp(); call = client(app.base); admin = await userSession(call, "admin")
})
afterAll(async () => { await app.close(); await pool.end() })

describe("B3 Pengaturan", () => {
  it("nilai awal dari PRD 11.3, nilai Diisi tim masih kosong", async () => {
    const r = await call("GET", "/api/admin/settings", { as: admin })
    const s = Object.fromEntries(r.json.settings.map((x: any) => [x.key, x.value]))
    expect(Object.keys(s).sort()).toEqual(Object.keys(SETTINGS).sort())
    expect(s).toMatchObject({ sun_hours: 4, system_loss_pct: 15, panel_degradation_pct: 0.5, tariff_escalation_pct: 3, work_mode: "SBU",
      battery_unlock_soc_pct: 60, day_hours: { start: 8, end: 16 }, analysis_years: 25, inverter_replace_year: 10,
      accessories_estimate_pct: 20, price_validity_days: 7, invoice_due_days: 7, proof_min_finished: 3,
      action_thresholds: { planning_days: 7, no_update_days: 3, refund_days: 7, stale_price_days: 30 },
      // tahap lanjutan (PRD 6.2, 6.3, 11.3)
      panel_wp_per_va: 1, battery_max_life_years: 10, service_base: 1000000, service_per_kwp: 2000000 })
    expect(Object.keys(s.tariff_per_va)).toEqual(["900", "1300", "2200", "3500", "4400", "5500", "6600"])
    expect(new Set(Object.values(s.tariff_per_va))).toEqual(new Set([1500]))
    for (const k of ["business_name", "service_area_text", "labor_rate_per_day"]) expect(s[k], k).toBeNull()
  })

  it("nilai yang tidak valid ditolak dan perubahan mencatat siapa yang mengubah", async () => {
    const put = (key: string, value: unknown) => call("PUT", `/api/admin/settings/${key}`, { as: admin, body: { value } })
    expect((await put("sun_hours", "empat")).status).toBe(400)
    expect((await put("day_share_pct", { sepi_siang: 25 })).status).toBe(400)
    expect((await put("tariff_per_va", { abc: 1500 })).status).toBe(400)
    expect((await put("tidak_ada", 1)).status).toBe(404)
    expect((await put("service_base", 2500000.5)).status).toBe(400)
    expect((await put("service_base", 2500000)).status).toBe(200)
    const row = await one(pool, "select value, updated_by from settings where key = 'service_base'")
    expect(row).toEqual({ value: 2500000, updated_by: admin.token && (await one(pool, "select id from users where role = 'admin' order by created_at limit 1"))!.id })
  })

  it("FAQ dan status bisa dikelola, status bawaan tidak bisa dinonaktifkan", async () => {
    const f = await call("POST", "/api/admin/faqs", { as: admin, body: { question: "Berapa lama pemasangan?", answer: "Diisi tim", sort_order: 1 } })
    expect(f.status).toBe(201)
    await call("PATCH", `/api/admin/faqs/${f.json.faq.id}`, { as: admin, body: { is_active: false } })
    expect((await call("GET", "/api/settings/public")).json.faqs).toEqual([])

    const statuses = (await call("GET", "/api/admin/statuses", { as: admin })).json.statuses
    expect(statuses.map((s: any) => s.system_key)).toEqual(["pengajuan", "planning", "menunggu_pembayaran", "on_progress", "selesai", "ditolak"])
    expect(statuses[3].sub_statuses.map((s: any) => s.name)).toEqual(["Pembelian Part", "Part Dikirim", "Pengetesan Part"])
    const planning = statuses[1]
    expect((await call("PATCH", `/api/admin/statuses/${planning.id}`, { as: admin, body: { is_active: false } })).status).toBe(400)
    expect((await call("PATCH", `/api/admin/statuses/${planning.id}`, { as: admin, body: { name: "Perencanaan" } })).json.status.name).toBe("Perencanaan")
    const extra = await call("POST", "/api/admin/statuses", { as: admin, body: { name: "Survey", show_to_client: true, sort_order: 7 } })
    expect((await call("PATCH", `/api/admin/statuses/${extra.json.status.id}`, { as: admin, body: { is_active: false } })).json.status.is_active).toBe(false)
    const sub = await call("POST", `/api/admin/statuses/${statuses[3].id}/sub-statuses`, { as: admin, body: { name: "Pemasangan", sort_order: 4 } })
    expect(sub.status).toBe(201)
    expect((await call("PATCH", `/api/admin/sub-statuses/${sub.json.sub_status.id}`, { as: admin, body: { is_active: false } })).json.sub_status.is_active).toBe(false)
  })
})
