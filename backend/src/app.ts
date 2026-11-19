import express from "express"
import { router as accounts } from "./features/accounts/accounts.js"
import { pool } from "./core/db.js"
import { allow, auth, cors, errors } from "./core/http.js"
import { router as parts } from "./features/parts/parts.js"
import { router as settings } from "./features/settings/settings.js"
import { router as simulations } from "./features/simulations/simulations.js"
import { router as projects } from "./features/projects/projects.js"
import { router as files } from "./features/files/files.js"
import { router as dashboard } from "./features/dashboard/dashboard.js"
import { router as planning } from "./features/planning/planning.js"
import { router as invoices } from "./features/invoices/invoices.js"
import { router as purchases } from "./features/purchases/purchases.js"

export const app = express()
app.disable("x-powered-by")
app.set("trust proxy", true)
app.use(cors)
app.use(express.json({ limit: "1mb" }))

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("select 1")
    res.json({ ok: true })
  } catch {
    res.status(503).json({ ok: false, error: "Database tidak bisa dihubungi" })
  }
})
app.use("/api", accounts)
// Halaman proyek (Status Pengerjaan, Invoice Pembelian) hanya untuk client dan admin (PRD bagian 2).
app.use("/api/projects", auth, allow("client", "admin"))
app.use("/api/admin", auth, allow("admin"))
app.use("/api", parts, settings, simulations, projects, files, dashboard, planning, invoices, purchases)

app.use("/api", (_req, res) => void res.status(404).json({ error: "Alamat tidak ditemukan", code: "NOT_FOUND" }))
app.use(errors)
