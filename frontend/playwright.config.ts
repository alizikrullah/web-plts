import { defineConfig } from "@playwright/test"

// Tes lewat layar (PRD bagian 13 dan 19.2): frontend asli di Chrome yang sudah terpasang, dengan backend khusus tes
// dan database plts_e2e yang dibangun ulang setiap kali. Persiapan data yang layarnya belum ada memakai API.
export default defineConfig({
  testDir: "src",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  timeout: 60_000,
  // Tes hanya memastikan PDF terbuka (alamat blob). Chrome tanpa layar tidak punya penampil PDF dan akan mengunduhnya,
  // jadi unduhan ditolak supaya tidak ada file yang masuk ke komputer.
  use: { baseURL: "http://localhost:5174", channel: "chrome", headless: true, acceptDownloads: false },
  webServer: [
    { command: "npx tsx src/test/e2e-server.ts", cwd: "../backend", url: "http://localhost:3100/api/health", timeout: 120_000, reuseExistingServer: false },
    { command: "npx vite --port 5174 --strictPort", url: "http://localhost:5174", timeout: 120_000, reuseExistingServer: false,
      env: { API_PROXY_TARGET: "http://localhost:3100" } },
  ],
})
