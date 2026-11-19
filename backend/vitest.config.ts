import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig } from "vitest/config"

// Tes memakai database plts_test dan folder sementara untuk file, bukan database dan penyimpanan Directus.
export default defineConfig({
  test: {
    env: {
      PGDATABASE: "plts_test", JWT_SECRET: "rahasia-khusus-tes", FRONTEND_ORIGIN: "http://localhost:5173",
      STORAGE_DIR: join(tmpdir(), "plts-tes-file"),
      // Tes tidak pernah memanggil Groq asli walaupun kuncinya sudah diisi di .env. Tes pembaca memakai tiruan.
      GROQ_API_KEY: "",
    },
    fileParallelism: false,
    hookTimeout: 60000,
    testTimeout: 60000,
  },
})
