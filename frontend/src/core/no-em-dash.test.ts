import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

// Aturan proyek: tidak boleh ada em dash (U+2014) di file mana pun, frontend maupun backend.
const EM_DASH = String.fromCharCode(0x2014)
const root = fileURLToPath(new URL("../../..", import.meta.url))
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  ["node_modules", "dist", ".git"].includes(e.name) ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])

// Batas waktu longgar: saat mesin sibuk (misalnya tepat setelah tes lewat layar), membaca semua file bisa lambat.
it("tidak ada em dash di proyek", { timeout: 30_000 }, () => {
  expect(walk(root).filter(f => readFileSync(f, "utf8").includes(EM_DASH))).toEqual([])
})
