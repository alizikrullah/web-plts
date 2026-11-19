import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Modul hitung ada di ../shared, dipakai bersama dengan backend.
// /api diteruskan ke backend saat pengembangan. Tes lewat layar memakai backend khusus tes (API_PROXY_TARGET).
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [".."] }, proxy: { "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000" } },
})
