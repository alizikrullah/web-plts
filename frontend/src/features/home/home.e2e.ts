import { expect, test } from "@playwright/test"
import { MENU, adminToken, call, expectMenu, loginUi, nav, newClient, newGuest, saveSimulation, submitSimulation } from "../../test/e2e"

test("skenario 4: admin menerima pengajuan saat guest masih login, guest melihat tampilan client tanpa login ulang", async ({ page, request }) => {
  const guest = await newGuest(request, "Guest Empat")
  await loginUi(page, guest.email)
  await expectMenu(page, MENU.guest)
  const project = await submitSimulation(request, guest.token)
  await call(request, "POST", `/api/admin/projects/${project.id}/accept`, { token: await adminToken(request) })

  await nav(page).getByRole("link", { name: "Akun" }).click()
  // Home dibuka: frontend memanggil /me, melihat role sudah client, lalu meminta token baru.
  await nav(page).getByRole("link", { name: "Home" }).click()
  await expect(page.getByRole("heading", { name: "Halo, Guest Empat" })).toBeVisible()
  await expectMenu(page, MENU.client)
  await nav(page).getByRole("link", { name: "Status Pengerjaan" }).click()
  await expect(page).toHaveURL(/\/status-pengerjaan/)
  await expect(page).not.toHaveURL(/\/masuk/)
})

test("Home pengunjung: cara kerja, area layanan dan FAQ dari Pengaturan, tombol WhatsApp, angka bukti tersembunyi", async ({ page, request }) => {
  await call(request, "POST", "/api/admin/faqs", { token: await adminToken(request), body: { question: "Berapa lama pemasangan?", answer: "Sekitar dua hari.", sort_order: 1 } })
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Cara kerja" })).toBeVisible()
  await expect(page.locator(".steps li")).toHaveText(["Simulasi", "Persetujuan", "Perhitungan detail", "Pemasangan"])
  await expect(page.getByText("Purwakarta, Karawang, dan sekitarnya")).toBeVisible()
  await page.getByText("Berapa lama pemasangan?").click()
  await expect(page.getByText("Sekitar dua hari.")).toBeVisible()
  await expect(page.getByRole("link", { name: "Chat lewat WhatsApp", exact: true })).toHaveAttribute("href", /^https:\/\/wa\.me\/6281200000099/)
  await expect(page.getByRole("heading", { name: "Sudah terpasang" })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Langkah berikutnya" })).toHaveCount(0)
})

test("kartu Langkah berikutnya guest mengikuti keadaannya: belum simulasi, tersimpan, diajukan, ditolak", async ({ page, request }) => {
  const guest = await newGuest(request, "Guest Kartu")
  await loginUi(page, guest.email)
  const card = page.locator(".next")
  await expect(card).toContainText("Mulai dari simulasi untuk tahu estimasi hemat Anda.")
  await expect(card.getByRole("link", { name: "Buka Simulator" })).toBeVisible()

  const sim = await saveSimulation(request, guest.token)
  await page.reload()
  await expect(card).toContainText("Mau lanjut ke perhitungan detail?")
  await expect(card.getByRole("link", { name: "Lanjutkan ke perhitungan detail" })).toHaveAttribute("href", `/simulator/${sim.id}`)

  const project = (await call(request, "POST", `/api/simulations/${sim.id}/submit`, { token: guest.token, body: { address: "Jl. Mawar 2", city: "Bandung" } })).project
  await page.reload()
  await expect(card).toContainText("Permintaan Anda sedang ditinjau. Kami akan menghubungi lewat WhatsApp.")
  await expect(card.getByRole("link", { name: "Chat admin" })).toBeVisible()

  await call(request, "POST", `/api/admin/projects/${project.id}/reject`, { token: await adminToken(request), body: { reason: "Di luar area layanan" } })
  await page.reload()
  await expect(card).toContainText("Pengajuan belum bisa kami proses: Di luar area layanan.")
  await expect(card.getByRole("link", { name: "Hitung ulang" })).toBeVisible()
})

test("dashboard client: salam, Langkah berikutnya sesuai status, tahap proyek, dan simulasi yang disetujui", async ({ page, request }) => {
  const client = await newClient(request, "Client Dashboard")
  await loginUi(page, client.email)
  await expect(page.getByRole("heading", { name: "Halo, Client Dashboard" })).toBeVisible()
  await expect(page.locator(".next")).toContainText("Tim kami sedang menyusun perhitungan detail sesuai lokasi Anda.")
  await expect(page.locator(".stages li[aria-current=step]")).toContainText("Planning")
  await expect(page.getByRole("heading", { name: "Simulasi yang disetujui" })).toBeVisible()
  await expect(page.getByText(/^Disetujui \d+ \w+ \d{4}$/)).toBeVisible()
  await expect(page.getByRole("heading", { name: "Invoice pembelian" })).toHaveCount(0)
})

test("dashboard admin: tombol cepat, Status Client bulanan, Perlu Tindakan, dan Tagihan", async ({ page, request }) => {
  const guest = await newGuest(request, "Guest Diajukan")
  const project = await submitSimulation(request, guest.token)
  await loginUi(page, "admin@e2e.test")
  await expect(page.getByRole("link", { name: "Client atau proyek baru" })).toBeVisible()
  await expect(page.locator("table.data")).toContainText("Guest Diajukan")
  await page.getByLabel("Status").selectOption("pengajuan")
  await expect(page.locator("table.data tbody tr").filter({ hasNotText: "Pengajuan" })).toHaveCount(0)
  await expect(page.locator("table.data")).toContainText("Guest Diajukan")
  const item = page.locator(".todo li", { hasText: project.code })
  await expect(item).toContainText("Pengajuan baru")
  await expect(item.getByRole("link", { name: "Tinjau dan terima" })).toHaveAttribute("href", `/client/${project.id}`)
  await expect(page.getByText("Total ditagih")).toBeVisible()
})
