import { createRequire } from "node:module"
import { expect, test, type Page } from "@playwright/test"
import type { SimSettings } from "../../../../shared/calc/simulator"
import { PASSWORD, adminToken, call, loginUi, mailLink, uniqueEmail } from "../../test/e2e"

// Modul hitung bersama tidak punya package.json sendiri, jadi Playwright memuatnya sebagai CommonJS.
const { packages } = createRequire(import.meta.url)("../../../../shared/calc/simulator.ts") as typeof import("../../../../shared/calc/simulator")
const { ONGRID_NOTE } = createRequire(import.meta.url)("./simple.ts") as typeof import("./simple")

const hemat = async (page: Page) => Number((await page.getByTestId("hemat").textContent())!.replace(/\D/g, ""))
const tierButtons = (page: Page) => page.getByRole("group", { name: "Paket" }).getByRole("button")

test("skenario 17 dan 18: daya PLN 2200 VA mendapat paket Standar dengan inverter 3000 W, 4 panel 550 Wp, dan baterai kelas 24 V (25,6 V)", async ({ page, request }) => {
  const parts = (await call(request, "GET", "/api/parts")).parts
  const settings = (await call(request, "GET", "/api/settings/public")).settings as SimSettings
  const of = (c: string) => parts.filter((p: { category: string }) => p.category === c)
  const std = packages({ panels: of("panel"), inverters: of("inverter"), batteries: of("baterai"), accessories: of("aksesoris") }, settings,
    { system_type: "hybrid_offgrid", pln_power_va: 2200, monthly_bill: 1_000_000, usage_pattern: "seimbang" }).find(p => p.tier === "standar")!
  expect([std.config.inverter.name, std.config.panel.name, std.config.panel_qty]).toEqual(["Inverter 3000 W 24 V", "Panel 550 Wp", 4])
  // Kelas 24 V dengan tegangan nominal 25,6 V dianggap cocok.
  expect(std.config.battery).toMatchObject({ battery_system_v: 24, voltage_v: 25.6 })

  await page.goto("/simulator")
  await page.getByLabel("Daya PLN").selectOption("2200")
  await page.getByLabel("Tagihan listrik per bulan").fill("1.000.000")
  await page.getByLabel("Pola pemakaian").selectOption("seimbang")
  await expect(tierButtons(page)).toHaveText(["Hemat", "Standar", "Premium"])
  await expect(page.getByRole("button", { name: "Standar", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText("4 × Panel 550 Wp", { exact: true })).toBeVisible()
  await expect(page.getByText("Inverter 3000 W 24 V", { exact: true })).toBeVisible()
  await expect(page.getByText(`1 × ${std.config.battery!.name}`, { exact: true })).toBeVisible()
  await expect(page.getByText("Jasa (perkiraan)")).toBeVisible()
  // Atur sendiri dimulai dari paket terpilih; mengubah part membuat simulasi tidak lagi tercatat sebagai paket.
  await page.getByRole("button", { name: "Atur sendiri" }).click()
  await expect(page.getByLabel("Inverter", { exact: true })).toHaveValue(std.config.inverter.id)
  await expect(page.getByLabel("Baterai", { exact: true })).toHaveValue(std.config.battery!.id)
  await expect(page.getByLabel("Jumlah panel")).toHaveValue("4")
  await page.getByLabel("Jumlah panel").selectOption("3")
  await expect(page.getByRole("button", { name: "Standar", exact: true })).toHaveAttribute("aria-pressed", "false")
  await page.getByRole("button", { name: "Kembali ke paket Standar" }).click()
  await expect(page.getByText("4 × Panel 550 Wp", { exact: true })).toBeVisible()
})

test("skenario 21: on-grid memakai paket tanpa baterai, keterangan PLN padam tampil", async ({ page }) => {
  await page.goto("/simulator")
  await page.getByRole("button", { name: "On-grid" }).click()
  await page.getByLabel("Daya PLN").selectOption("2200")
  await page.getByLabel("Pola pemakaian").selectOption("sepi_siang")
  await expect(page.getByRole("button", { name: "Standar", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator("p.part-name")).toHaveText(["4 × Panel 550 Wp", "Inverter on-grid 2000 W"])
  await expect(page.getByText(ONGRID_NOTE).first()).toBeVisible()
  await expect(page.getByTestId("hemat")).toBeVisible()
  await expect(page.locator("label", { hasText: /^Baterai$/ })).toHaveCount(0)
})

test("skenario 25: kelas tanpa baterai yang cocok tidak tampil, dan jenis sistem tanpa paket membuka WhatsApp", async ({ page, request }) => {
  const token = await adminToken(request)
  const parts = (await call(request, "GET", "/api/admin/parts", { token })).parts as { id: string; name: string; category: string; system_type: string | null; package_tier: string | null }[]
  const off = parts.filter(p => p.name === "LiFePO4 48 V 100 Ah" || (p.category === "inverter" && p.system_type === "on_grid" && p.package_tier))
  for (const p of off) await call(request, "PATCH", `/api/admin/parts/${p.id}`, { token, body: { package_tier: null } })
  try {
    await page.goto("/simulator")
    await page.getByLabel("Daya PLN").selectOption("2200")
    await expect(tierButtons(page)).toHaveText(["Hemat", "Standar"])
    await page.getByRole("button", { name: "On-grid" }).click()
    await expect(page.getByRole("link", { name: "Tanya lewat WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/6281200000099\?text=/)
    await expect(page.getByTestId("hemat")).toHaveCount(0)
  } finally {
    for (const p of off) await call(request, "PATCH", `/api/admin/parts/${p.id}`, { token, body: { package_tier: p.package_tier } })
  }
})

test("skenario 16: hemat per bulan di mode sederhana tidak pernah melebihi tagihan", async ({ page }) => {
  await page.goto("/simulator")
  for (const bill of [150_000, 400_000, 1_500_000]) {
    await page.getByLabel("Tagihan listrik per bulan").fill(bill.toLocaleString("id-ID"))
    for (const pattern of ["sepi_siang", "seimbang", "ramai_siang"]) {
      await page.getByLabel("Pola pemakaian").selectOption(pattern)
      await expect(page.getByTestId("hemat")).toBeVisible()
      expect(await hemat(page), `tagihan ${bill}, pola ${pattern}`).toBeLessThanOrEqual(bill)
    }
  }
})

test("skenario 8: pengunjung mengisi simulator, daftar, verifikasi email, lalu masuk; isian terakhir masih ada, lalu simpan dan ajukan", async ({ page, request }) => {
  await page.goto("/simulator")
  await page.getByLabel("Daya PLN").selectOption("3500")
  await page.getByLabel("Tagihan listrik per bulan").fill("2.500.000")
  await page.getByLabel("Pola pemakaian").selectOption("ramai_siang")
  await page.getByRole("link", { name: "Daftar untuk menyimpan" }).click()
  await page.getByLabel("Nama").fill("Guest Delapan")
  const email = uniqueEmail()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Nomor WhatsApp").fill("081234567890")
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Daftar" }).click()
  await expect(page.getByRole("heading", { name: "Cek email Anda" })).toBeVisible()
  // Link verifikasi dibuka seperti dari aplikasi email, lalu masuk: kembali ke Simulator.
  await page.goto(await mailLink(request, email))
  await page.getByRole("main").getByRole("link", { name: "Masuk", exact: true }).click()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Masuk" }).click()
  await expect(page).toHaveURL(/\/simulator$/)
  await expect(page.getByLabel("Daya PLN")).toHaveValue("3500")
  await expect(page.getByLabel("Tagihan listrik per bulan")).toHaveValue("2.500.000")
  await expect(page.getByLabel("Pola pemakaian")).toHaveValue("ramai_siang")

  await page.getByRole("button", { name: "Simpan simulasi" }).click()
  await expect(page.getByRole("heading", { name: "Simulasi tersimpan" })).toBeVisible()
  await expect(page.getByText("tagihan Rp2.500.000 per bulan")).toBeVisible()
  await page.getByRole("button", { name: "Lanjutkan ke perhitungan detail" }).click()
  await page.getByLabel("Alamat pemasangan").fill("Jl. Kenanga 8")
  await page.getByLabel("Kota").fill("Purwakarta")
  await page.getByRole("button", { name: "Kirim pengajuan" }).click()
  await expect(page.getByText("Permintaan Anda sedang ditinjau")).toBeVisible()
  await page.reload()
  await expect(page.getByText("Simulasi ini sudah diajukan.")).toBeVisible()
})

test("skenario 7: simulasi dengan tegangan panel melebihi batas inverter tidak bisa diajukan", async ({ page, request }) => {
  const token = (await call(request, "POST", "/api/auth/login", { body: { email: "bahaya@e2e.test", password: PASSWORD } })).access_token
  const sim = (await call(request, "GET", "/api/simulations", { token })).simulations[0]
  await loginUi(page, "bahaya@e2e.test")
  await page.goto(`/simulator/${sim.id}`)
  await expect(page.getByText("Tegangan rangkaian panel melebihi batas inverter")).toBeVisible()
  await expect(page.getByRole("button", { name: "Lanjutkan ke perhitungan detail" })).toBeDisabled()
  await expect(page.getByText("Ada saran berlabel Bahaya di simulasi ini, jadi belum bisa diajukan.")).toBeVisible()
})

test("admin memakai mode lengkap: isian simulator HTML, opsi baterai 2 kali lipat, dan Bahaya saat panel seri berlebih", async ({ page }) => {
  await loginUi(page, "admin@e2e.test")
  await page.goto("/simulator")
  await expect(page.getByRole("heading", { name: "Simulator mode lengkap" })).toBeVisible()
  await expect(page.getByLabel("Beban siang")).toBeVisible()
  await expect(page.getByText("Baterai 2× lipat")).toBeVisible()
  await page.getByRole("textbox", { name: "Panel seri" }).fill("9")
  await expect(page.locator(".advice li.bad")).toContainText("melebihi batas")
})
