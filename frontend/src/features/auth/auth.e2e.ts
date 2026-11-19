import { expect, test } from "@playwright/test"
import { MENU, PASSWORD, adminToken, call, expectMenu, loginUi, nav, newClient, uniqueEmail } from "../../test/e2e"

test("skenario 3: form daftar dikirim dengan tambahan isian role admin, akun tetap guest", async ({ page, request }) => {
  // Isian role disisipkan ke kiriman form, seperti orang yang mengutak-atik permintaan dari browser.
  await page.route("**/api/auth/register", route => route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), role: "admin" }) }))
  const email = uniqueEmail()
  await page.goto("/daftar")
  await page.getByLabel("Nama").fill("Guest Tiga")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Nomor WhatsApp").fill("0812 3456 7890")
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Daftar" }).click()
  await expectMenu(page, MENU.guest)
  await nav(page).getByRole("link", { name: "Akun" }).click()
  await expect(page.getByText("Guest", { exact: true })).toBeVisible()
  const token = (await call(request, "POST", "/api/auth/login", { body: { email, password: PASSWORD } })).access_token
  expect((await call(request, "GET", "/api/me", { token })).user).toMatchObject({ role: "guest", whatsapp: "6281234567890" })
})

test("masuk dengan password salah ditolak dengan pesan yang jelas", async ({ page }) => {
  await page.goto("/masuk")
  await page.getByLabel("Email").fill("admin@e2e.test")
  await page.getByLabel("Password").fill("password-salah")
  await page.getByRole("button", { name: "Masuk" }).click()
  await expect(page.getByRole("alert")).toHaveText("Email atau password salah")
  await expectMenu(page, MENU.visitor)
})

test("password sementara wajib diganti sebelum memakai fitur lain", async ({ page, request }) => {
  const email = uniqueEmail()
  const created = await call(request, "POST", "/api/admin/users", { token: await adminToken(request), body: { name: "Admin Baru", email, whatsapp: "081200000002" } })
  await page.goto("/masuk")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(created.temporary_password)
  await page.getByRole("button", { name: "Masuk" }).click()
  await expect(page).toHaveURL(/\/akun$/)
  await expect(page.getByText("Anda masuk dengan password sementara")).toBeVisible()
  await expectMenu(page, ["Akun"])
  await page.goto("/pengaturan")
  await expect(page).toHaveURL(/\/akun$/)
  await page.getByLabel("Password lama").fill(created.temporary_password)
  await page.getByLabel("Password baru", { exact: true }).fill("password-baru-123")
  await page.getByLabel("Ulangi password baru").fill("password-baru-123")
  await page.getByRole("button", { name: "Ganti password" }).click()
  await expect(page.getByText("Password sudah diganti.")).toBeVisible()
  await expectMenu(page, MENU.admin)
  await nav(page).getByRole("link", { name: "Pengaturan" }).click()
  await expect(page.getByRole("heading", { name: "Pengaturan" })).toBeVisible()
})

test("skenario 14: akun client dinonaktifkan, akses berhenti paling lama 15 menit kemudian", async ({ page, request }) => {
  const client = await newClient(request, "Client Empat Belas")
  await page.clock.install()
  await loginUi(page, client.email)
  await nav(page).getByRole("link", { name: "Status Pengerjaan" }).click()
  await expect(page.getByRole("heading", { name: "Status Pengerjaan" })).toBeVisible()
  await call(request, "PATCH", `/api/admin/users/${client.id}`, { token: await adminToken(request), body: { is_active: false } })
  // Access token yang sudah terbit masih berlaku sampai habis (paling lama 15 menit).
  await page.clock.fastForward("10:00")
  await expectMenu(page, MENU.client)
  // Saat token perlu diperbarui, refresh token sudah dicabut: client keluar dan diminta masuk lagi.
  await page.clock.fastForward("05:00")
  await expect(page).toHaveURL(/\/masuk$/)
  await expectMenu(page, MENU.visitor)
  await page.getByLabel("Email").fill(client.email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Masuk" }).click()
  await expect(page.getByRole("alert")).toHaveText("Akun dinonaktifkan. Hubungi admin.")
})
