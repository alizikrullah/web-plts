import { expect, test } from "@playwright/test"
import { PNG, confirmedPurchase, loginUi, paidProject } from "../../test/e2e"

test("skenario 13: proyek ditandai Selesai saat pengembalian belum dicatat ditolak dengan alasannya, lalu bisa ditutup setelah beres", async ({ page, browser, request }) => {
  const c = await paidProject(request, "Client Tiga Belas")
  await confirmedPurchase(request, c.project.id, c.invoice.amount_parts - 200000)
  await loginUi(page, "admin@e2e.test")
  await page.goto(`/client/${c.project.id}?tab=status`)

  // Update biasa dengan catatan dan foto, tanpa ganti status.
  await page.getByLabel("Catatan").fill("Panel sudah terpasang di atap")
  await page.getByLabel("Foto proses").setInputFiles(PNG)
  await page.getByRole("button", { name: "Simpan update" }).click()
  await expect(page.getByText("Update status tersimpan.")).toBeVisible()
  await expect(page.locator(".history li").first()).toContainText("Panel sudah terpasang di atap")
  await expect(page.locator(".history li").first().locator(".photo img")).toBeVisible()

  // Ditutup padahal kelebihan bayar Rp200.000 belum dikembalikan: ditolak dengan alasannya.
  await page.getByLabel("Status", { exact: true }).selectOption({ label: "Selesai" })
  await page.getByLabel("Catatan").fill("Pemasangan selesai")
  await page.getByRole("button", { name: "Simpan update" }).click()
  await expect(page.getByRole("alert")).toContainText("Proyek belum bisa ditandai Selesai: Pengembalian ke client belum dicatat penuh")

  await page.getByRole("button", { name: "Invoice Pembelian" }).click()
  await expect(page.getByLabel("Jumlah dikembalikan")).toHaveValue("200000")
  await page.getByRole("button", { name: "Simpan pengembalian" }).click()
  await expect(page.getByText("Pengembalian tercatat.")).toBeVisible()

  await page.getByRole("button", { name: "Status Pengerjaan" }).click()
  await page.getByLabel("Status", { exact: true }).selectOption({ label: "Selesai" })
  await page.getByLabel("Catatan").fill("Pemasangan selesai")
  await page.getByRole("button", { name: "Simpan update" }).click()
  await expect(page.locator(".head .sub b")).toHaveText("Selesai")

  // Client melihat riwayat dengan foto dan status Selesai.
  const client = await (await browser.newContext({ baseURL: "http://localhost:5174" })).newPage()
  await loginUi(client, c.email)
  await client.goto("/status-pengerjaan")
  await expect(client.locator(".stages li[aria-current=step]")).toContainText("Selesai")
  await expect(client.locator(".history")).toContainText("Panel sudah terpasang di atap")
  await expect(client.getByRole("heading", { name: "Update status" })).toHaveCount(0)
  await expect(client.getByRole("button", { name: "Unduh PDF" })).toBeVisible()
})
