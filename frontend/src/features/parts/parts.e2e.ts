import { expect, test } from "@playwright/test"
import { adminToken, call, loginUi, newClient, newGuest } from "../../test/e2e"

test("skenario 6: part dinonaktifkan dari List Part hilang dari pilihan Simulator dan Planning, simulasi lama tetap tampil benar", async ({ page, browser, request }) => {
  await loginUi(page, "admin@e2e.test")
  await page.goto("/list-part")
  await page.getByRole("link", { name: "Tambah part" }).click()
  await expect(page).toHaveURL(/\/list-part\/baru$/)
  await expect(page.locator("table.data")).toHaveCount(0)
  await page.getByLabel("Nama", { exact: true }).fill("Panel Uji 500 Wp")
  await page.getByLabel("Harga satuan").fill("1500000")
  await page.getByLabel("Daya (Wp)").fill("500")
  await page.getByLabel("Voc (V)").fill("45")
  await page.getByLabel("Vmp (V)").fill("38")
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page.locator("table.data")).toContainText("Panel Uji 500 Wp")

  // Guest menyimpan simulasi dengan part itu sebelum dinonaktifkan.
  const guest = await newGuest(request, "Guest Enam")
  const parts = (await call(request, "GET", "/api/parts")).parts as { id: string; name: string }[]
  const id = (n: string) => parts.find(p => p.name === n)!.id
  const sim = (await call(request, "POST", "/api/simulations", { token: guest.token, body: { system_type: "hybrid_offgrid", pln_power_va: 2200, monthly_bill: 1000000,
    usage_pattern: "seimbang", panel_part_id: id("Panel Uji 500 Wp"), panel_qty: 4, inverter_part_id: id("Inverter 3000 W 24 V"),
    battery_part_id: id("LiFePO4 24 V 100 Ah"), battery_qty: 1 } })).simulation

  await page.locator("tr", { hasText: "Panel Uji 500 Wp" }).getByRole("link", { name: "Ubah" }).click()
  await expect(page).toHaveURL(/\/list-part\/[0-9a-f-]{36}\/ubah$/)
  await expect(page.getByRole("heading", { name: "Ubah Panel Uji 500 Wp" })).toBeVisible()
  await expect(page.locator("table.data")).toHaveCount(0)
  await page.getByLabel("Aktif (muncul di pilihan Simulator dan Planning)").uncheck()
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page.getByText("Panel Uji 500 Wp tersimpan.")).toBeVisible()
  await expect(page.locator("table.data")).not.toContainText("Panel Uji 500 Wp")
  await page.getByLabel("Status").selectOption("false")
  await expect(page.locator("table.data")).toContainText("Panel Uji 500 Wp")
  // filter tetap sama setelah membuka halaman ubah lalu batal
  await page.locator("tr", { hasText: "Panel Uji 500 Wp" }).getByRole("link", { name: "Ubah" }).click()
  await page.getByRole("button", { name: "Batal" }).click()
  await expect(page).toHaveURL(/\/list-part\?.*status=false/)
  await expect(page.getByLabel("Status")).toHaveValue("false")

  // Hilang dari pilihan Planning.
  const c = await newClient(request, "Client Enam")
  await page.goto(`/client/${c.project.id}?tab=planning`)
  await page.getByRole("button", { name: "Tambah Part" }).click()
  await expect(page.getByRole("region", { name: "Part" }).getByLabel("Part").last().locator("option", { hasText: "Panel Uji 500 Wp" })).toHaveCount(0)

  // Hilang dari pilihan Simulator, simulasi lama tetap utuh.
  const visitor = await (await browser.newContext({ baseURL: "http://localhost:5174" })).newPage()
  await visitor.goto("/simulator")
  await visitor.getByRole("button", { name: "Atur sendiri" }).click()
  await expect(visitor.getByLabel("Panel", { exact: true })).toBeVisible()
  await expect(visitor.getByLabel("Panel", { exact: true }).locator("option", { hasText: "Panel Uji 500 Wp" })).toHaveCount(0)
  await loginUi(visitor, guest.email)
  await visitor.goto(`/simulator/${sim.id}`)
  await expect(visitor.getByText("4 × Panel Uji 500 Wp")).toBeVisible()
  await expect(visitor.getByText(`Rp${sim.monthly_saving.toLocaleString("id-ID")}`).first()).toBeVisible()
})

test("skenario 19: pengunjung tanpa login meminta daftar part dan pengaturan, toko, link beli, catatan, dan cara pembayaran tidak ikut terkirim", async ({ page, request }) => {
  await call(request, "POST", "/api/admin/parts", { token: await adminToken(request), body: { category: "baterai", name: "Baterai Uji 24 V", unit: "unit", unit_price: 9000000,
    battery_system_v: 24, capacity_ah: 100, voltage_v: 25.6, dod_pct: 90, store_name: "Toko Rahasia", buy_url: "https://toko.example/rahasia", notes: "Catatan khusus admin" } })
  const parts = page.waitForResponse(r => r.url().endsWith("/api/parts"))
  const settings = page.waitForResponse(r => r.url().endsWith("/api/settings/public"))
  await page.goto("/simulator")
  const text = (await (await parts).text()) + (await (await settings).text())
  expect(text).toContain("Baterai Uji 24 V")
  for (const secret of ["store_name", "buy_url", "notes", "Toko Rahasia", "toko.example", "Catatan khusus", "payment_instructions", "Transfer ke BCA"])
    expect(text, secret).not.toContain(secret)
})

test("skenario 5: harga part diubah setelah simulasi diajukan, angka di simulasi yang diajukan tidak berubah", async ({ page, browser, request }) => {
  const guest = await newGuest(request, "Guest Lima")
  const parts = (await call(request, "GET", "/api/parts")).parts as { id: string; name: string }[]
  const id = (n: string) => parts.find(p => p.name === n)!.id
  const sim = (await call(request, "POST", "/api/simulations", { token: guest.token, body: { system_type: "hybrid_offgrid", pln_power_va: 2200, monthly_bill: 1000000,
    usage_pattern: "seimbang", panel_part_id: id("Panel 450 Wp"), panel_qty: 4, inverter_part_id: id("Inverter 3000 W 24 V"),
    battery_part_id: id("LiFePO4 24 V 100 Ah premium"), battery_qty: 1 } })).simulation
  await call(request, "POST", `/api/simulations/${sim.id}/submit`, { token: guest.token, body: { address: "Jl. Mawar 5", city: "Bandung" } })

  await loginUi(page, "admin@e2e.test")
  await page.goto("/list-part")
  await page.locator("tr", { hasText: "Panel 450 Wp" }).getByRole("link", { name: "Ubah" }).click()
  await page.getByLabel("Harga satuan").fill("2000000")
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page.locator("tr", { hasText: "Panel 450 Wp" })).toContainText("Rp2.000.000")

  const g = await (await browser.newContext({ baseURL: "http://localhost:5174" })).newPage()
  await loginUi(g, guest.email)
  await g.goto(`/simulator/${sim.id}`)
  await expect(g.getByText("Simulasi ini sudah diajukan.")).toBeVisible()
  await expect(g.locator("dl.sum")).toContainText(`Rp${sim.est_investment.toLocaleString("id-ID")}`)
  await expect(g.locator("dl.sum")).toContainText(`Rp${sim.monthly_saving.toLocaleString("id-ID")}`)
})

test("tahap lanjutan: admin mengisi kelas paket, Isc, dan aturan jumlah aksesoris dari List Part", async ({ page, request }) => {
  await loginUi(page, "admin@e2e.test")
  await page.goto("/list-part")
  await page.getByRole("link", { name: "Tambah part" }).click()
  await page.getByLabel("Kategori", { exact: true }).selectOption("aksesoris")
  await page.getByLabel("Nama", { exact: true }).fill("Klem Uji")
  await page.getByLabel("Satuan", { exact: true }).fill("pcs")
  await page.getByLabel("Harga satuan").fill("12000")
  await page.getByLabel("Dipakai di estimasi Simulator").selectOption("per_panel")
  await page.getByLabel("Jumlah per panel").fill("2")
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page.locator("tr", { hasText: "Klem Uji" })).toContainText("Simulator: 2 pcs per panel")

  await page.locator("tr", { hasText: "Panel 450 Wp" }).getByRole("link", { name: "Ubah" }).click()
  await page.getByLabel("Isc (A)").fill("11.5")
  await page.getByLabel("Kelas paket").selectOption("hemat")
  await page.getByRole("button", { name: "Simpan" }).click()
  const row = page.locator("tr", { hasText: "Panel 450 Wp" })
  await expect(row.locator("td").nth(2)).toHaveText("Hemat")
  await expect(row.locator("td.spec")).toHaveText("450 Wp · Voc 41,5 V · Vmp 34,6 V · Isc 11,5 A")
  // inverter menampilkan jenis sistemnya, dan filter bisa memilih inverter on-grid saja
  await page.getByLabel("Kategori").selectOption("inverter:on_grid")
  await expect(page.locator("table.data tbody tr td:nth-child(2)")).toHaveText(Array(2).fill(/^InverterOn-grid$/))

  const parts = (await call(request, "GET", "/api/parts")).parts as { name: string; [k: string]: unknown }[]
  expect(parts.find(p => p.name === "Klem Uji")).toMatchObject({ qty_basis: "per_panel", qty_per_basis: 2, system_type: null })
  expect(parts.find(p => p.name === "Panel 450 Wp")).toMatchObject({ isc: 11.5, package_tier: "hemat" })
  // kembalikan supaya tes lain memakai data awal
  const token = await adminToken(request)
  await call(request, "PATCH", `/api/admin/parts/${parts.find(p => p.name === "Panel 450 Wp")!.id}`, { token, body: { package_tier: null, isc: null } })
})
