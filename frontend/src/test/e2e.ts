import { expect, type APIRequestContext, type Page } from "@playwright/test"

// Pembantu tes lewat layar. Data yang layarnya belum ada (simpan simulasi di F2, terima pengajuan dan Kelola Akun di F4)
// disiapkan lewat API backend tes. Yang diuji tetap tampilan di browser.
export const API = "http://localhost:3100"
export const PASSWORD = "password-e2e"
export const MENU = {
  visitor: ["Home", "Simulator", "Masuk", "Daftar"],
  guest: ["Home", "Simulator", "Akun"],
  client: ["Home", "Simulator", "Status Pengerjaan", "Invoice Pembelian", "Akun"],
  admin: ["Home", "Simulator", "Client", "List Part", "Pengaturan", "Akun"],
}

export async function call(request: APIRequestContext, method: string, path: string, o: { token?: string; body?: unknown } = {}) {
  const r = await request.fetch(API + path, { method, data: o.body, headers: o.token ? { authorization: `Bearer ${o.token}` } : {} })
  const json = await r.json().catch(() => null)
  if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${JSON.stringify(json)}`)
  return json
}

export const adminToken = async (request: APIRequestContext) =>
  (await call(request, "POST", "/api/auth/login", { body: { email: "admin@e2e.test", password: PASSWORD } })).access_token as string

let n = 0
export const uniqueEmail = () => `user${Date.now()}${++n}@e2e.test`

// Email tidak benar-benar dikirim saat tes. Backend tes menyimpannya, dan linknya diambil dari sini.
export async function mailLink(request: APIRequestContext, email: string) {
  const mails = (await call(request, "GET", "/api/__test/outbox")).mails as { to: string; text: string }[]
  const text = mails.filter(m => m.to === email).at(-1)?.text ?? ""
  const link = text.match(/https?:\/\/[^/\s]+(\/[\w-]+\?token=[\w-]+)/)
  if (!link) throw new Error("Email untuk " + email + " tidak ditemukan")
  return link[1]
}

// Guest baru: daftar, verifikasi email lewat link di email, lalu masuk.
export async function newGuest(request: APIRequestContext, name: string) {
  const email = uniqueEmail()
  await call(request, "POST", "/api/auth/register", { body: { name, email, whatsapp: "081200000000", password: PASSWORD } })
  const token = new URLSearchParams((await mailLink(request, email)).split("?")[1]).get("token")
  await call(request, "POST", "/api/auth/verify-email", { body: { token } })
  const r = await call(request, "POST", "/api/auth/login", { body: { email, password: PASSWORD } })
  return { name, email, id: r.user.id as string, token: r.access_token as string }
}

// Guest menyimpan simulasi (4 panel 550 Wp, inverter 3000 W, 1 baterai).
export async function saveSimulation(request: APIRequestContext, token: string) {
  const parts = (await call(request, "GET", "/api/parts")).parts as { id: string; name: string }[]
  const id = (name: string) => parts.find(p => p.name === name)!.id
  return (await call(request, "POST", "/api/simulations", { token, body: { system_type: "hybrid_offgrid", pln_power_va: 2200, monthly_bill: 1000000,
    usage_pattern: "seimbang", panel_part_id: id("Panel 550 Wp"), panel_qty: 4, inverter_part_id: id("Inverter 3000 W 24 V"),
    battery_part_id: id("LiFePO4 24 V 100 Ah"), battery_qty: 1 } })).simulation as { id: string; monthly_saving: number }
}

// Guest menyimpan simulasi lalu mengajukan perhitungan detail.
export async function submitSimulation(request: APIRequestContext, token: string) {
  const sim = await saveSimulation(request, token)
  return (await call(request, "POST", `/api/simulations/${sim.id}/submit`, { token, body: { address: "Jl. Mawar 1", city: "Bandung" } })).project as { id: string; code: string }
}

// Guest yang pengajuannya sudah diterima admin, jadi client dengan proyek di Planning.
export async function newClient(request: APIRequestContext, name: string) {
  const g = await newGuest(request, name)
  const project = await submitSimulation(request, g.token)
  await call(request, "POST", `/api/admin/projects/${project.id}/accept`, { token: await adminToken(request) })
  return { ...g, project }
}

// Proyek yang Planning-nya final dan tagihan awalnya terbit (status Menunggu Pembayaran).
export async function invoicedProject(request: APIRequestContext, name: string) {
  const c = await newClient(request, name), token = await adminToken(request)
  await call(request, "POST", `/api/admin/projects/${c.project.id}/planning/finalize`, { token, body: {} })
  const invoice = (await call(request, "POST", `/api/admin/projects/${c.project.id}/invoices`, { token, body: {} })).invoice
  return { ...c, invoice: invoice as { id: string; number: string; total: number; amount_parts: number } }
}

// Proyek yang tagihan awalnya sudah lunas (status On Progress).
export async function paidProject(request: APIRequestContext, name: string) {
  const c = await invoicedProject(request, name)
  await call(request, "POST", `/api/admin/invoices/${c.invoice.id}/payments`, { token: await adminToken(request),
    body: { amount: c.invoice.total, paid_at: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), method: "Transfer" } })
  return c
}

// Pembelian tanpa nota yang langsung dikonfirmasi.
export async function confirmedPurchase(request: APIRequestContext, projectId: string, total: number) {
  const token = await adminToken(request)
  const x = (await call(request, "POST", `/api/admin/projects/${projectId}/purchases`, { token, body: { document_type: "tanpa_nota", item_group: "komponen_utama",
    store_name: "Toko Surya", purchase_date: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), subtotal_products: total, total_paid: total,
    items: [{ name: "Paket komponen", unit: "paket", qty: 1, unit_price: total }] } })).purchase
  await call(request, "POST", `/api/admin/purchases/${x.id}/confirm`, { token, body: {} })
  return x as { id: string }
}

// File kecil yang lolos pemeriksaan jenis file di backend.
export const PNG = { name: "bukti.png", mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") }
export const PDF = { name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%uji\n") }

// Navbar: menu utama ditambah Masuk, Daftar, atau Akun yang dibuat terpisah dari menu.
export const nav = (page: Page) => page.getByRole("banner")
export const expectMenu = (page: Page, items: string[]) => expect(nav(page).getByRole("navigation").getByRole("link")).toHaveText(items)

export async function loginUi(page: Page, email: string, password = PASSWORD) {
  await page.goto("/masuk")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Masuk" }).click()
  await expect(nav(page).getByRole("link", { name: "Akun" })).toBeVisible()
}
