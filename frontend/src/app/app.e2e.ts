import { expect, test } from "@playwright/test"
import { MENU, PASSWORD, expectMenu, loginUi, nav, newClient, newGuest } from "../test/e2e"

// F1: navbar per role dan penjaga rute (PRD bagian 2), dilihat lewat layar.
test("pengunjung melihat menu Home, Simulator, Masuk, Daftar; halaman client meminta masuk lalu kembali ke halaman itu", async ({ page, request }) => {
  await page.goto("/")
  await expectMenu(page, MENU.visitor)
  const client = await newClient(request, "Client Tujuan")
  await page.goto("/status-pengerjaan")
  await expect(page).toHaveURL(/\/masuk$/)
  await expect(page.getByText("Silakan masuk dulu untuk membuka halaman itu.")).toBeVisible()
  await page.getByLabel("Email").fill(client.email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Masuk" }).click()
  await expect(page).toHaveURL(/\/status-pengerjaan$/)
  await expect(page.getByRole("heading", { name: "Status Pengerjaan" })).toBeVisible()
})

test("skenario 2: guest membuka Status Pengerjaan atau Invoice Pembelian, ditolak dan diarahkan ke Home", async ({ page, request }) => {
  const guest = await newGuest(request, "Guest Dua")
  await loginUi(page, guest.email)
  await expectMenu(page, MENU.guest)
  for (const path of ["/status-pengerjaan", "/invoice-pembelian"]) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText("Halaman itu tidak bisa dibuka dengan akun Anda.")).toBeVisible()
    await expect(page.getByRole("heading", { name: /Berapa listrik/ })).toBeVisible()
  }
})

test("client dan admin melihat menu sesuai role, halaman admin hanya untuk admin", async ({ page, request }) => {
  const client = await newClient(request, "Client Menu")
  await loginUi(page, client.email)
  await expectMenu(page, MENU.client)
  await page.goto("/pengaturan")
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText("Halaman itu tidak bisa dibuka dengan akun Anda.")).toBeVisible()
  await nav(page).getByRole("link", { name: "Akun" }).click()
  await page.getByRole("button", { name: "Keluar" }).click()
  await expectMenu(page, MENU.visitor)

  await loginUi(page, "admin@e2e.test")
  await expectMenu(page, MENU.admin)
  for (const name of ["Client", "List Part", "Pengaturan", "Status Pengerjaan"]) {
    if (name === "Status Pengerjaan") await page.goto("/status-pengerjaan")
    else await nav(page).getByRole("link", { name }).click()
    await expect(page.getByRole("heading", { name })).toBeVisible()
  }
})

test("kondisi memuat: Home tidak menampilkan tampilan pengunjung selama sesi masih dicek", async ({ page, request }) => {
  const client = await newClient(request, "Client Memuat")
  await loginUi(page, client.email)
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  await page.route("**/api/auth/refresh", async route => { await held; await route.continue() })
  await page.goto("/")
  await expect(page.getByRole("status")).toHaveText("Memuat...")
  await expect(page.getByRole("heading", { name: /Berapa listrik/ })).toHaveCount(0)
  await expectMenu(page, ["Home", "Simulator"])
  release()
  await expect(page.getByRole("heading", { name: "Halo, Client Memuat" })).toBeVisible()
  await expectMenu(page, MENU.client)
})

test("di HP, menu dibuka lewat tombol Menu, sedangkan Masuk dan Daftar selalu terlihat sebagai tombol", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto("/")
  const akun = page.getByRole("navigation", { name: "Akun" })
  await expect(akun.getByRole("link", { name: "Masuk" })).toBeVisible()
  await expect(akun.getByRole("link", { name: "Daftar" })).toHaveClass(/\bpri\b/)
  await expect(nav(page).getByRole("link", { name: "Simulator" })).toBeHidden()
  await page.getByRole("button", { name: "Menu" }).click()
  await nav(page).getByRole("link", { name: "Simulator" }).click()
  await expect(page.getByRole("heading", { name: "Simulator PLTS Rumah" })).toBeVisible()
  await expect(nav(page).getByRole("link", { name: "Simulator" })).toBeHidden()
  await akun.getByRole("link", { name: "Daftar" }).click()
  await expect(page.getByRole("heading", { name: "Daftar" })).toBeVisible()
})
