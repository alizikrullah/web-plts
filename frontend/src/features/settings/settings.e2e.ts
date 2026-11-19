import { expect, test } from "@playwright/test"
import { adminToken, call, loginUi, nav, uniqueEmail } from "../../test/e2e"

test("Pengaturan: nilai dipakai Home, FAQ dan sub-status dikelola, Kelola Akun membuat admin dan menonaktifkan akun", async ({ page, request }) => {
  await loginUi(page, "admin@e2e.test")
  await nav(page).getByRole("link", { name: "Pengaturan" }).click()
  const area = page.locator("form.setting", { has: page.getByLabel("Teks area layanan") })
  await area.getByLabel("Teks area layanan").fill("Bandung Raya dan Purwakarta")
  await area.getByRole("button", { name: "Simpan" }).click()
  await expect(area.getByText("Tersimpan.")).toBeVisible()
  await expect(area.getByText(/^Diubah Admin E2E,/)).toBeVisible()

  await page.getByRole("button", { name: "FAQ" }).click()
  await page.getByLabel("Pertanyaan").last().fill("Apakah ada garansi?")
  await page.getByLabel("Jawaban").last().fill("Ada, sesuai garansi toko tiap part.")
  await page.getByRole("button", { name: "Tambah" }).click()
  await expect(page.getByText("FAQ ditambahkan.")).toBeVisible()

  await page.getByRole("button", { name: "Status", exact: true }).click()
  const onProgress = page.locator(".card", { has: page.locator('input[value="On Progress"]') })
  await onProgress.getByLabel("Sub-status baru").fill("Pemasangan")
  await onProgress.getByRole("button", { name: "Tambah sub-status" }).click()
  await expect(onProgress.locator('input[value="Pemasangan"]')).toBeVisible()

  await page.getByRole("button", { name: "Kelola Akun" }).click()
  const email = uniqueEmail()
  await page.getByLabel("Nama", { exact: true }).fill("Admin Kedua")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Nomor WhatsApp").fill("081255556666")
  await page.getByRole("button", { name: "Buat admin" }).click()
  await expect(page.getByText(new RegExp(`Password sementara untuk ${email}: \\S{12}\\.`))).toBeVisible()
  await page.getByLabel("Cari akun").fill(email)
  await page.getByRole("button", { name: "Cari", exact: true }).click()
  await expect(page.locator("table.data tbody tr")).toHaveCount(1)
  await page.getByRole("button", { name: "Nonaktifkan" }).click()
  await expect(page.getByText(`Akun ${email} dinonaktifkan.`)).toBeVisible()
  await expect(page.locator("table.data tbody tr")).toContainText("Nonaktif")

  // Home pengunjung memakai teks area layanan dan FAQ yang baru.
  await nav(page).getByRole("link", { name: "Akun" }).click()
  await page.getByRole("button", { name: "Keluar" }).click()
  await expect(page.getByText("Bandung Raya dan Purwakarta")).toBeVisible()
  await expect(page.getByText("Apakah ada garansi?")).toBeVisible()
  await call(request, "PUT", "/api/admin/settings/service_area_text", { token: await adminToken(request), body: { value: "Purwakarta, Karawang, dan sekitarnya" } })
})
