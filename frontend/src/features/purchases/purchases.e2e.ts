import { expect, test } from "@playwright/test"
import { PDF, PNG, loginUi, paidProject } from "../../test/e2e"

test("skenario 10 dan 11: invoice toko online diunggah menjadi draf, pengecekan jumlah lolos, draf tidak terlihat client sampai dikonfirmasi", async ({ page, browser, request }) => {
  const c = await paidProject(request, "Client Sebelas")
  const client = await (await browser.newContext({ baseURL: "http://localhost:5174" })).newPage()
  await loginUi(client, c.email)

  await loginUi(page, "admin@e2e.test")
  await page.goto(`/client/${c.project.id}?tab=pembelian`)
  await page.getByLabel("File invoice atau nota (PDF, JPG, PNG)").setInputFiles(PDF)
  await page.getByRole("button", { name: "Buat draf" }).click()
  await expect(page.getByText("Draf pembelian dibuat.")).toBeVisible()
  // Draf tampil di samping preview file aslinya (PRD 10.1 langkah 4).
  await expect(page.locator(".draft .preview iframe")).toBeVisible()
  // Pembaca invoice dimatikan di tes lewat layar, jadi draf diisi manual (pembacaan otomatis dites di backend).
  const draft = page.locator(".draft")
  await draft.getByLabel("Toko").fill("rpvsurya")
  await draft.getByLabel("Tanggal beli").fill("2026-10-23")
  await draft.getByLabel("Nama barang").fill("Kabel Solar PV 1x10mm")
  await draft.getByLabel("Satuan barang", { exact: true }).fill("meter")
  await draft.getByLabel("Qty", { exact: true }).fill("20")
  await draft.getByLabel("Harga satuan barang").fill("47440")
  await draft.getByLabel("Subtotal barang").fill("948800")
  await draft.getByLabel("Potongan", { exact: true }).fill("48800")
  // Angka tidak cocok dulu (948.800 - 48.800 = 900.000, bukan 899.000): ditandai perlu dicek.
  await draft.getByLabel("Total dibayar").fill("899000")
  await draft.getByRole("button", { name: "Simpan draf" }).click()
  await expect(draft.locator(".pill")).toHaveText("Perlu dicek")
  await draft.getByLabel("Total dibayar").fill("900000")
  await draft.getByRole("button", { name: "Simpan draf" }).click()
  await expect(draft.locator(".pill")).toHaveText("Jumlah cocok")

  // Masih draf: client belum melihatnya, dan belanja aktual di rekap masih nol.
  await client.goto(`/invoice-pembelian?proyek=${c.project.id}`)
  await expect(client.getByText("Belum ada pembelian terkonfirmasi.")).toBeVisible()
  await expect(client.locator("table.recap tr", { hasText: "C. Belanja aktual" })).toContainText("Rp0")

  await draft.getByRole("button", { name: "Konfirmasi" }).click()
  await expect(page.locator(".draft")).toHaveCount(0)
  await client.reload()
  await expect(client.getByRole("region", { name: "Komponen Utama" })).toContainText("Kabel Solar PV 1x10mm")
  await expect(client.getByRole("region", { name: "Komponen Utama" })).toContainText("20 meter")
  await expect(client.locator("table.recap tr", { hasText: "C. Belanja aktual" })).toContainText("Rp900.000")
  await expect(client.getByRole("button", { name: "Invoice terlampir" })).toBeVisible()
  await expect(client.getByRole("button", { name: "Unduh gabungan (PDF)" })).toBeVisible()
  await expect(client.getByRole("heading", { name: "Tambah pembelian" })).toHaveCount(0)
})

test("skenario 12: tagihan tambahan tanpa bukti setuju client ditolak, setelah bukti diisi tagihannya terbit", async ({ page, request }) => {
  const c = await paidProject(request, "Client Dua Belas")
  await loginUi(page, "admin@e2e.test")
  await page.goto(`/client/${c.project.id}?tab=pembelian`)
  await page.getByLabel("Jumlah", { exact: true }).fill("500000")
  await page.getByLabel("Alasan").selectOption("kenaikan_harga")
  await page.getByLabel("Penjelasan").fill("Harga inverter naik")
  await page.getByRole("button", { name: "Catat", exact: true }).click()
  await expect(page.getByText("Belum ada bukti setuju.")).toBeVisible()

  await page.getByRole("checkbox").check()
  await expect(page.getByRole("button", { name: "Buat tagihan tambahan" })).toBeDisabled()
  await page.getByRole("button", { name: "Pratinjau tagihan tambahan" }).click()
  await expect(page.getByRole("alert")).toHaveText("Bukti setuju client (tanggal dan file) wajib ada sebelum tagihan tambahan dibuat")

  await page.getByRole("button", { name: "Isi bukti setuju" }).click()
  await page.getByLabel("File bukti").setInputFiles(PNG)
  await page.getByRole("button", { name: "Simpan bukti" }).click()
  await expect(page.getByText(/Disetujui \d+/)).toBeVisible()
  await page.getByRole("checkbox").check()
  const preview = page.waitForEvent("popup")
  await page.getByRole("button", { name: "Pratinjau tagihan tambahan" }).click()
  await expect.poll(async () => (await preview).url()).toMatch(/^blob:/)
  await (await preview).close()
  await page.getByRole("button", { name: "Buat tagihan tambahan" }).click()
  await expect(page.getByText("Tagihan tambahan terbit.")).toBeVisible()
  await page.getByRole("button", { name: "Penagihan" }).click()
  await expect(page.getByText("Tagihan tambahan")).toBeVisible()
})
