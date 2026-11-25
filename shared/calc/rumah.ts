// Rumus simulasi PLTS rumah (hybrid off-grid), dipindah apa adanya dari frontend/legacy/simulator-plts-2.html.
// Dipakai bersama oleh frontend dan backend (PRD bagian 6), supaya hasil di layar sama dengan yang disimpan.
// frontend/src/calc/rumah.test.ts memastikan hasilnya tetap sama persis dengan versi lama.
// Tambahan 25 Nov 2026 (PRD 6.1): cek string memakai batas MPPT dan arus dari List Part, plus saran khusus on-grid.
// Tanpa isian tambahan itu, hasil dan saran sama persis dengan simulator HTML lama.
import { bepTxt, fmtNum, n1, rpS } from "../format"

export type Mode = "SBU" | "SOL"

export interface Params {
  tarif: number; tagihan: number; esc: number
  wp: number; seri: number; paralel: number; psh: number; voc: number; vmp: number; loss: number; deg: number
  pvMax: number; vocMax: number; invRated: number; invEff: number; ah: number; bv: number; dod: number; mode: Mode; unlock: number
  pDay: number; pNight: number; hStart: number; hEnd: number
  cPanel: number; cInv: number; cBat: number; cEtc: number; yInv: number; yBat: number; years: number
  // Boleh kosong: batas MPPT inverter (bawaan 30 sampai 170 V seperti HTML lama), Isc panel, arus input maksimal inverter, dan penanda on-grid.
  mpptMin?: number; mpptMax?: number; isc?: number; iMax?: number; onGrid?: boolean
}

export const DEF: Params = {
  tarif: 1500, tagihan: 5000000, esc: 3, wp: 550, seri: 4, paralel: 1, psh: 4, voc: 50.1, vmp: 42.1, loss: 15, deg: 0.5,
  pvMax: 2700, vocMax: 245, invRated: 3000, invEff: 92, ah: 100, bv: 25.6, dod: 90, mode: "SBU", unlock: 60,
  pDay: 1.4, pNight: 0.3, hStart: 8, hEnd: 16, cPanel: 1700000, cInv: 6080000, cBat: 12000000, cEtc: 5120000, yInv: 10, yBat: 0, years: 25,
}

export type Sim = ReturnType<typeof simulate>
export type Fin = ReturnType<typeof finance>
export interface Row { name: string; s: Sim; i: number; f: Fin; q: Params }
export type Kind = "ok" | "warn" | "bad" | "tip"
export interface Tip { kind: Kind; text: string }

/* simulasi harian, langkah 15 menit, 3 hari agar SOC stabil, diambil hari ke-3 */
export function simulate(p: Params) {
  const dt = 0.25, steps = 24 / dt, wpTot = p.wp * p.seri * p.paralel
  const dcDay = wpTot * p.psh * (1 - p.loss / 100)            // Wh DC sebelum clipping
  const peak = dcDay / (24 / Math.PI)                      // W puncak kurva sinus 06-18
  const eff = Math.max(0.5, p.invEff / 100), ec = 0.96, ed = 0.96
  const cap = p.ah * p.bv, smin = cap * (1 - p.dod / 100), sUnlock = cap * Math.min(1, Math.max(p.unlock, 0) / 100)
  let soc = cap * 0.5, locked = false
  const prof = { pv: [] as number[], load: [] as number[], soc: [] as number[] }
  let r = { pvDirect: 0, bat: 0, grid: 0, waste: 0, clip: 0, loadE: 0, charged: 0 }
  for (let d = 0; d < 3; d++) {
    r = { pvDirect: 0, bat: 0, grid: 0, waste: 0, clip: 0, loadE: 0, charged: 0 }
    for (let i = 0; i < steps; i++) {
      const t = i * dt + dt / 2
      const pvRaw = t > 6 && t < 18 ? peak * Math.sin(Math.PI * (t - 6) / 12) : 0
      const pv = Math.min(pvRaw, p.pvMax); r.clip += (pvRaw - pv) * dt
      const hs = p.hStart, he = p.hEnd, inDay = hs <= he ? t >= hs && t < he : t >= hs || t < he
      const loadW = (inDay ? p.pDay : p.pNight) * 1000; r.loadE += loadW * dt
      const loadDC = loadW / eff
      if (cap > 0 && locked && soc >= sUnlock) locked = false
      if (cap > 0 && !locked && soc <= smin + 1e-6) locked = true
      const batAllowed = cap > 0 && !locked && (p.mode === "SBU" || pv > 0)
      let gridW = 0
      if (cap > 0 && locked) {                 // bypass: beban dari PLN, PV hanya mengisi baterai
        gridW = loadW
        const ch = Math.min(pv * ec * dt, cap - soc); soc += ch; r.charged += ch
        r.waste += pv * dt - ch / ec
      } else if (pv >= loadDC) {
        r.pvDirect += loadW * dt
        const sur = pv - loadDC, ch = cap > 0 ? Math.min(sur * ec * dt, cap - soc) : 0; soc += ch; r.charged += ch
        r.waste += sur * dt - ch / ec
      } else {
        r.pvDirect += pv * eff * dt
        const defDC = (loadDC - pv) * dt
        let dis = 0
        if (batAllowed) { dis = Math.min(defDC, (soc - smin) * ed); soc -= dis / ed }
        r.bat += dis * eff
        gridW = (defDC - dis) * eff / dt
      }
      r.grid += gridW * dt
      if (d === 2) { prof.pv.push(pv * eff); prof.load.push(loadW); prof.soc.push(cap > 0 ? soc / cap * 100 : 0) }
    }
  }
  const kwh = (x: number) => x / 1000
  const saved = kwh(r.pvDirect + r.bat)
  return {
    wpTot, dcDay: kwh(dcDay), clip: kwh(r.clip), pvDirect: kwh(r.pvDirect), bat: kwh(r.bat), grid: kwh(r.grid),
    waste: kwh(r.waste), loadE: kwh(r.loadE), saved, charged: kwh(r.charged), cap: kwh(cap), prof,
  }
}

export function finance(p: Params, sim: Sim, invest: number) {
  const Y = Math.max(1, Math.round(p.years))
  const cum = [-invest]
  let c = -invest, bep: number | null = null
  const y1 = sim.saved * 365 * p.tarif
  for (let y = 1; y <= Y; y++) {
    const s = y1 * Math.pow(1 + p.esc / 100, y - 1) * Math.pow(1 - p.deg / 100, y - 1)
    let cost = 0
    if (p.yInv > 0 && y % Math.round(p.yInv) === 0 && y < Y) cost += p.cInv
    if (p.yBat > 0 && p.ah > 0 && y % Math.round(p.yBat) === 0 && y < Y) cost += p.cBat
    const prev = c; c += s - cost; cum.push(c)
    if (bep === null && prev < 0 && c >= 0) bep = (y - 1) + (-prev) / (s - cost)
  }
  if (invest <= 0) bep = 0
  return { cum, bep, y1, month: y1 / 12, net: c }
}

export function investOf(p: Params) {
  return p.cPanel * p.seri * p.paralel + p.cInv + (p.ah > 0 ? p.cBat : 0) + p.cEtc
}

/* opsi pembanding; baris pertama selalu konfigurasi user */
export function compareOptions(p: Params) {
  const opts: [string, Params][] = [["Konfigurasi Anda", p]]
  if (p.ah > 0) opts.push(["Tanpa baterai", { ...p, ah: 0 }])
  const maxPanels = Math.floor(p.pvMax / p.wp)
  const nowPanels = p.seri * p.paralel
  if (maxPanels > nowPanels) {
    const maxSeri = Math.max(1, Math.floor(p.vocMax / (p.voc * 1.05)))
    const par = Math.ceil(maxPanels / maxSeri), seri = Math.floor(maxPanels / par)
    if (seri * par > nowPanels) opts.push([`Panel maksimal (${seri * par} pcs)`, { ...p, seri, paralel: par }])
  }
  if (p.ah > 0) opts.push(["Baterai 2× lipat", { ...p, ah: p.ah * 2, cBat: p.cBat * 2 }])
  opts.push(p.mode === "SBU" ? ["Mode SOL", { ...p, mode: "SOL" }] : ["Mode SBU", { ...p, mode: "SBU" }])
  const rows: Row[] = opts.map(([name, q]) => { const s = simulate(q), i = investOf(q), f = finance(q, s, i); return { name, s, i, f, q } })
  let best: Row | null = null
  for (const r of rows) if (r.f.bep !== null && (best === null || r.f.bep < best.f.bep!)) best = r
  return { rows, best }
}

export function advice(p: Params, rows: Row[]) {
  const { s: sim, f: fin } = rows[0]
  const A: Tip[] = []
  const add = (kind: Kind, text: string) => A.push({ kind, text })
  const vocStr = p.seri * p.voc, vocCold = vocStr * 1.05, vmpStr = p.seri * p.vmp
  if (vocCold > p.vocMax) add("bad", `Voc string ${n1(vocStr)} V (±${n1(vocCold)} V saat dingin) melebihi batas ${fmtNum(p.vocMax)} V. Kurangi panel seri menjadi maksimal ${Math.floor(p.vocMax / (p.voc * 1.05))}.`)
  else add("ok", `Voc string ${n1(vocStr)} V, masih di bawah batas ${fmtNum(p.vocMax)} V. Vmp kerja sekitar ${n1(vmpStr)} V.`)
  const lo = p.mpptMin ?? 30, hi = p.mpptMax ?? 170
  if (vmpStr * 0.88 < lo) add("warn", `Vmp string saat panas bisa turun ke ±${n1(vmpStr * 0.88)} V, mendekati batas bawah MPPT ${fmtNum(lo)} V. Tambah panel seri.`)
  if (vmpStr > hi) add("warn", `Vmp ${n1(vmpStr)} V di atas rentang optimal MPPT (${fmtNum(lo)}-${fmtNum(hi)} V). Efisiensi bisa turun.`)
  // Arus: 1 string di atas batas hanya clipping, beberapa string paralel di atas batas berbahaya (PRD 6.1).
  if (p.isc && p.iMax && p.isc * p.paralel > p.iMax) add(p.paralel > 1 ? "bad" : "warn", p.paralel > 1
    ? `Arus ${p.paralel} string paralel ±${n1(p.isc * p.paralel)} A melebihi arus input inverter ${fmtNum(p.iMax)} A. Kurangi string paralel.`
    : `Isc panel ${n1(p.isc)} A di atas arus input inverter ${fmtNum(p.iMax)} A. Ada sedikit clipping saat terik, masih aman.`)
  if (p.onGrid) {
    const ratio = sim.wpTot / p.invRated
    if (ratio < 1.1) add("warn", `Rasio panel terhadap inverter ${n1(ratio, 2)}. Inverter belum terpakai penuh, idealnya 1,1 sampai 1,4.`)
    else if (ratio > 1.4) add("warn", `Rasio panel terhadap inverter ${n1(ratio, 2)}, di atas 1,4. Akan ada clipping saat terik.`)
  }
  if (sim.wpTot > p.pvMax) add("warn", `Total PV ${n1(sim.wpTot, 0)} Wp di atas batas inverter ${fmtNum(p.pvMax)} W. Sekitar ${n1(sim.clip)} kWh/hari terpotong (clipping).`)
  // On-grid: beban rumah tetap disuplai PLN, jadi batas beban inverter tidak berlaku.
  if (!p.onGrid && Math.max(p.pDay, p.pNight) * 1000 > p.invRated * 0.8) add("warn", `Beban ${n1(Math.max(p.pDay, p.pNight))} kW sudah di atas 80% kapasitas inverter ${fmtNum(p.invRated)} W. Beri ruang untuk lonjakan motor (pompa, kulkas, AC).`)
  const wasteTot = sim.waste + sim.clip
  if (wasteTot > 0.1 * sim.dcDay) add("tip", p.onGrid
    ? `${n1(wasteTot)} kWh PV per hari terbuang, karena kelebihan listrik on-grid tidak mengurangi tagihan. Geser pemakaian ke jam 10-14 (cuci, setrika, pompa air, AC).`
    : `${n1(wasteTot)} kWh PV per hari terbuang. Geser pemakaian ke jam 10-14 (cuci, setrika, pompa air, AC) atau tambah kapasitas baterai.`)
  // On-grid: pemakaian malam selalu dari PLN, jadi menambah panel tidak menolongnya.
  if (!p.onGrid && sim.grid > 0.4 * sim.loadE && sim.wpTot < p.pvMax) add("tip", `${n1(sim.grid / sim.loadE * 100, 0)}% beban masih dari PLN. Menambah panel sampai ±${fmtNum(p.pvMax)} Wp masih bisa terpakai dan inverter sanggup.`)
  if (p.ah > 0) {
    const cyc = sim.charged / Math.max(0.01, sim.cap)
    if (cyc < 0.3) add("tip", `Baterai hanya terisi ±${n1(cyc * 100, 0)}% kapasitas per hari dari PV. Untuk pola beban ini baterai lebih berfungsi sebagai cadangan saat PLN padam. Bandingkan dengan opsi "Tanpa baterai" di bagian Opsi.`)
    else add("ok", `Baterai terpakai ±${n1(cyc * 100, 0)}% kapasitas per hari, siklus yang sehat untuk LiFePO4.`)
  }
  const noBat = rows.find(r => r.name === "Tanpa baterai")
  if (noBat && fin.bep !== null && noBat.f.bep !== null && noBat.f.bep < fin.bep - 1) add("tip", `Tanpa baterai balik modal ${bepTxt(noBat.f.bep)} (vs ${bepTxt(fin.bep)}). Baterai layak dipertahankan bila listrik sering padam atau ada beban penting yang tidak boleh mati.`)
  if (fin.bep === null) add("bad", `Tidak balik modal dalam ${fmtNum(p.years)} tahun. Kurangi biaya, tambah panel, atau naikkan beban siang yang dilayani inverter.`)
  else if (fin.bep > 10) add("warn", `BEP ${bepTxt(fin.bep)}, cukup lama untuk inverter murah (umur 5-10 th). Pastikan garansi dan pertimbangkan biaya penggantian.`)
  else add("ok", `BEP ${bepTxt(fin.bep)} dengan untung bersih ${rpS(fin.net)} selama ${fmtNum(p.years)} tahun.`)
  if (p.tagihan > 0) add("tip", `Penghematan ${rpS(fin.month)}/bulan = ${n1(fin.month / p.tagihan * 100, 1)}% dari tagihan ${rpS(p.tagihan)}.${p.onGrid ? "" : " Hanya beban yang disambung ke AC OUT yang ikut hemat."}`)
  add("tip", "Hadapkan panel ke utara dengan kemiringan 10-15° dan bersihkan permukaan tiap 1-2 bulan. Debu dan bayangan kecil bisa memangkas produksi 10-25%.")
  add("tip", "Gunakan setting tipe baterai USER: tegangan boost 28,4 V, float 27,0 V, putus 22,4 V untuk LiFePO4 8S, dan cek tegangan per sel di aplikasi BMS.")
  return A
}
