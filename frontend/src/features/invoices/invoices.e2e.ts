import { expect, test } from "@playwright/test"
import { invoicedProject, loginUi, newClient } from "../../test/e2e"

const statusHeader = (page: import("@playwright/test").Page) => page.locator(".head .sub b")

test("skenario 9: Planning dijadikan final, tagihan awal terbit lalu dicatat lunas, status pindah ke Menunggu Pembayaran lalu On Progress", async ({ page, request }) => {
  const c = await newClient(request, "Client Sembilan")
  await loginUi(page, "admin@e2e.test")
  await page.goto(`/client/${c.project.id}?tab=planning`)
  // Panel, inverter, dan baterai sudah terisi dari simulasi; admin menambah jasa dan SDM.
  await expect(page.getByRole("region", { name: "Part" }).locator("tbody tr")).toHaveCount(3)
  await page.getByRole("button", { name: "Tambah Jasa" }).click()
  await page.getByRole("region", { name: "Jasa" }).getByLabel("Uraian").fill("Instalasi dan setting inverter")
  await page.getByRole("region", { name: "Jasa" }).getByLabel("Nominal").fill("2500000")
  await page.getByRole("button", { name: "Tambah SDM" }).click()
  await page.getByRole("button", { name: "Simpan draf" }).click()
  await expect(page.getByText("Planning tersimpan.")).toBeVisible()
  await expect(page.getByText("Total SDM: Rp300.000")).toBeVisible()
  await page.getByRole("button", { name: "Jadikan final" }).click()
  await expect(page.getByText("Planning sudah final.")).toBeVisible()
  await expect(page.getByText(/^Harga berlaku sampai /)).toBeVisible()

  await page.getByRole("button", { name: "Penagihan" }).click()
  await page.getByRole("button", { name: "Terbitkan tagihan awal" }).click()
  await expect(page.getByText("Tagihan awal terbit.")).toBeVisible()
  await expect(statusHeader(page)).toHaveText("Menunggu Pembayaran")
  const popup = page.waitForEvent("popup")
  await page.getByRole("button", { name: "Unduh PDF" }).click()
  await expect.poll(async () => (await popup).url()).toMatch(/^blob:/)

  // Dibayar dua kali: status baru pindah setelah lunas.
  await page.getByRole("button", { name: "Catat pembayaran" }).click()
  await page.getByLabel("Jumlah dibayar").fill("1000000")
  await page.getByRole("button", { name: "Simpan pembayaran" }).click()
  await expect(page.getByText("Pembayaran tercatat.")).toBeVisible()
  await expect(statusHeader(page)).toHaveText("Menunggu Pembayaran")
  await page.getByRole("button", { name: "Catat pembayaran" }).click()
  await page.getByRole("button", { name: "Simpan pembayaran" }).click()
  await expect(page.locator(".pill.lunas")).toHaveText("Lunas")
  await expect(statusHeader(page)).toHaveText("On Progress")
  await expect(page.locator(".head .sub")).toContainText("Pembelian Part")
})

test("skenario 20: tagihan awal yang belum dibayar dibatalkan, proyek kembali ke Planning dan Planning bisa diubah lagi", async ({ page, request }) => {
  const c = await invoicedProject(request, "Client Dua Puluh")
  await loginUi(page, "admin@e2e.test")
  await page.goto(`/client/${c.project.id}?tab=penagihan`)
  await expect(statusHeader(page)).toHaveText("Menunggu Pembayaran")
  page.once("dialog", d => d.accept("Harga sudah tidak berlaku"))
  await page.getByRole("button", { name: "Batalkan tagihan" }).click()
  await expect(page.locator(".pill.batal")).toHaveText("Batal")
  await expect(statusHeader(page)).toHaveText("Planning")

  await page.getByRole("button", { name: "Planning", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Planning (draf)" })).toBeVisible()
  await page.getByRole("button", { name: "Tambah Akomodasi" }).click()
  await page.getByRole("region", { name: "Akomodasi" }).getByLabel("Uraian").fill("Transport tim")
  await page.getByRole("region", { name: "Akomodasi" }).getByLabel("Nominal").fill("300000")
  await page.getByRole("button", { name: "Simpan draf" }).click()
  await expect(page.getByText("Planning tersimpan.")).toBeVisible()
  await expect(page.getByText("Total Akomodasi: Rp300.000")).toBeVisible()
  // Tagihan baru bisa diterbitkan lagi setelah Planning final.
  await page.getByRole("button", { name: "Jadikan final" }).click()
  await page.getByRole("button", { name: "Penagihan" }).click()
  await page.getByRole("button", { name: "Terbitkan tagihan awal" }).click()
  await expect(statusHeader(page)).toHaveText("Menunggu Pembayaran")
  await expect(page.locator(".pill.terbit")).toHaveText("Belum lunas")
})
