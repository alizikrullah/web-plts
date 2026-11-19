import { Route, Routes } from "react-router"
import AccountPage from "../features/account/AccountPage"
import LoginPage from "../features/auth/LoginPage"
import RegisterPage from "../features/auth/RegisterPage"
import HomePage from "../features/home/HomePage"
import PartsPage from "../features/parts/PartsPage"
import ClientProjectPage from "../features/projects/ClientProjectPage"
import NewProjectPage from "../features/projects/NewProjectPage"
import ProjectListPage from "../features/projects/ProjectListPage"
import ProjectPage from "../features/projects/ProjectPage"
import SettingsPage from "../features/settings/SettingsPage"
import SavedSimulation from "../features/simulator/SavedSimulation"
import SimulatorPage from "../features/simulator/SimulatorPage"
import { NotFound } from "../core/ui"
import { AnonOnly, RequireRole } from "./guards"
import Layout from "./Layout"

// Akses per halaman mengikuti PRD bagian 2.
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="simulator" element={<SimulatorPage />} />
        <Route path="simulator/:id" element={<RequireRole><SavedSimulation /></RequireRole>} />
        <Route path="masuk" element={<AnonOnly><LoginPage /></AnonOnly>} />
        <Route path="daftar" element={<AnonOnly><RegisterPage /></AnonOnly>} />
        <Route path="akun" element={<RequireRole><AccountPage /></RequireRole>} />
        <Route path="status-pengerjaan" element={<RequireRole roles={["client", "admin"]}><ClientProjectPage view="status" /></RequireRole>} />
        <Route path="invoice-pembelian" element={<RequireRole roles={["client", "admin"]}><ClientProjectPage view="pembelian" /></RequireRole>} />
        <Route path="client" element={<RequireRole roles={["admin"]}><ProjectListPage /></RequireRole>} />
        <Route path="client/baru" element={<RequireRole roles={["admin"]}><NewProjectPage /></RequireRole>} />
        <Route path="client/:id" element={<RequireRole roles={["admin"]}><ProjectPage /></RequireRole>} />
        <Route path="list-part" element={<RequireRole roles={["admin"]}><PartsPage /></RequireRole>} />
        <Route path="pengaturan" element={<RequireRole roles={["admin"]}><SettingsPage /></RequireRole>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
