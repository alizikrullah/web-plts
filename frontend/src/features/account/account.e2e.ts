import { expect, test } from "@playwright/test"
import { MENU, call, expectMenu, loginUi, nav, newGuest } from "../../test/e2e"

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
