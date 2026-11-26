import { expect, test } from "@playwright/test"
import { MENU, call, expectMenu, loginUi, nav, newClient, newGuest } from "../../test/e2e"

test("halaman Akun: ubah nama dan WhatsApp, ganti password, lalu keluar mencabut sesi", async ({ page, request }) => {
  const guest = await newGuest(request, "Guest Akun")
  await loginUi(page, guest.email)
  await nav(page).getByRole("link", { name: "Akun" }).click()
  await expect(page.getByLabel("Nomor WhatsApp")).toHaveValue("081200000000")

  await page.getByLabel("Nama").fill("Guest Akun Baru")
  await page.getByLabel("Nomor WhatsApp").fill("0813 1111 2222")
  await page.getByRole("button", { name: "Simpan data" }).click()
  await expect(page.getByText("Data akun tersimpan.")).toBeVisible()
  expect((await call(request, "GET", "/api/me", { token: guest.token })).user).toMatchObject({ name: "Guest Akun Baru", whatsapp: "6281311112222" })

  await page.getByLabel("Password lama").fill("salah-sekali")
  await page.getByLabel("Password baru", { exact: true }).fill("password-baru-123")
  await page.getByLabel("Ulangi password baru").fill("password-baru-123")
  await page.getByRole("button", { name: "Ganti password" }).click()
  await expect(page.getByRole("alert")).toHaveText("Password lama salah")
  await page.getByLabel("Password lama").fill("password-e2e")
  await page.getByRole("button", { name: "Ganti password" }).click()
  await expect(page.getByText("Password sudah diganti.")).toBeVisible()

  await page.getByRole("button", { name: "Keluar" }).click()
  await expect(page).toHaveURL(/\/$/)
  await expectMenu(page, MENU.visitor)
  // Refresh token sudah dicabut: dimuat ulang pun tetap sebagai pengunjung.
  await page.reload()
  await expectMenu(page, MENU.visitor)
  await loginUi(page, guest.email, "password-baru-123")
  await expectMenu(page, MENU.guest)
})

test("Kelola Akun: guest dijadikan admin lalu guest lagi, akun kosong dihapus, client tidak bisa dijadikan admin atau dihapus", async ({ page, request }) => {
  const guest = await newGuest(request, "Guest Naik Admin"), c = await newClient(request, "Client Tetap")
  await loginUi(page, "admin@e2e.test")
  await page.goto("/pengaturan?bagian=akun")
  const row = (email: string) => page.locator("table.data tbody tr", { hasText: email })
  const find = async (email: string) => { await page.getByLabel("Cari akun").fill(email); await page.getByRole("button", { name: "Cari", exact: true }).click() }

  await find(guest.email)
  await row(guest.email).getByRole("button", { name: "Jadikan admin" }).click()
  await expect(page.getByText(`${guest.email} sekarang admin.`)).toBeVisible()
  await expect(row(guest.email)).toContainText("Admin")
  await row(guest.email).getByRole("button", { name: "Jadikan guest" }).click()
  await expect(page.getByText(`${guest.email} sekarang guest.`)).toBeVisible()
  await expect(row(guest.email)).toContainText("Guest")

  await find(c.email)
  await expect(row(c.email).getByRole("button", { name: "Jadikan admin" })).toHaveCount(0)
  page.once("dialog", d => void d.accept())
  await row(c.email).getByRole("button", { name: "Hapus" }).click()
  await expect(page.getByRole("alert")).toHaveText("Akun ini punya proyek, jadi tidak bisa dihapus. Nonaktifkan saja.")

  await find(guest.email)
  page.once("dialog", d => void d.accept())
  await row(guest.email).getByRole("button", { name: "Hapus" }).click()
  await expect(page.getByText(`Akun ${guest.email} dihapus.`)).toBeVisible()
  await expect(row(guest.email)).toHaveCount(0)
})
