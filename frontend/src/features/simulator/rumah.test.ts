import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { parseNum } from "../../../../shared/format"
import { DEF, advice, compareOptions, type Params } from "../../../../shared/calc/rumah"

// Rumus asli diambil langsung dari HTML lama, lalu hasilnya dibandingkan dengan versi baru.
const html = readFileSync(new URL("../../../legacy/simulator-plts-2.html", import.meta.url), "utf8")
const cut = (from: string, to: string) => {
  const i = html.indexOf(from), j = html.indexOf(to, i)
  if (i < 0 || j < 0) throw new Error(`Potongan "${from}" tidak ketemu di HTML lama`)
  return html.slice(i, j)
}
const legacy = new Function("p", [
  cut("const rp=", "/* angka format"),
  cut("function simulate(", "function css("),
  "const sim=simulate(p),fin=finance(p,sim,investOf(p));",
  cut("const opts=[];", '$("tOpt")'),
  cut("const A=[];", '$("advice")'),
  "return {rows,best,A};",
].join("\n")) as (p: Params) => { rows: any[]; best: any; A: string[] }

// prodDC kode mati (selalu sama dengan dcDay), sudah dihapus di versi baru
const strip = ({ prodDC: _, ...s }: any) => s
// angka di dalam kalimat saran: susunan kata boleh berubah, angkanya tidak
const nums = (t: string) => (t.match(/\d[\d.,]*/g) ?? []).map(parseNum)
const oldTip = (li: string) => {
  const [, kind, text] = li.match(/^<li class="(\w+)"><b>[^<]*<\/b>(.*)<\/li>$/s)!
  return [kind, nums(text)]
}

let seed = 7
const rnd = (a: number, b: number) => a + ((seed = (seed * 16807) % 2147483647) / 2147483647) * (b - a)
const int = (a: number, b: number) => Math.floor(rnd(a, b + 1))
const cases: Params[] = [
  DEF,
  { ...DEF, ah: 0 },
  { ...DEF, mode: "SOL" },
  { ...DEF, hStart: 18, hEnd: 6 },
  { ...DEF, psh: 0 },
  { ...DEF, tarif: 0, tagihan: 0 },
  { ...DEF, cPanel: 0, cInv: 0, cBat: 0, cEtc: 0 },
  ...Array.from({ length: 300 }, (): Params => ({
    ...DEF,
    tagihan: int(0, 1) * 5e6, esc: rnd(0, 8), seri: int(1, 8), paralel: int(1, 3), psh: rnd(2, 6),
    vmp: rnd(20, 45), loss: rnd(5, 25), deg: rnd(0, 1), ah: [0, 50, 100, 200][int(0, 3)], dod: rnd(50, 100),
    mode: int(0, 1) ? "SBU" : "SOL", unlock: rnd(0, 100), pDay: rnd(0, 3), pNight: rnd(0, 1.5),
    hStart: int(0, 23), hEnd: int(0, 23), yInv: int(0, 12), yBat: int(0, 12), years: int(1, 30),
  })),
]

it("hasil sama persis dengan simulator-plts-2.html", () => {
  cases.forEach((p, n) => {
    const old = legacy(p), { rows, best } = compareOptions(p)
    expect(rows, `kasus ${n}`).toEqual(old.rows.map(r => ({ ...r, s: strip(r.s) })))
    expect(best?.name, `kasus ${n}`).toBe(old.best?.name)
    expect(advice(p, rows).map(t => [t.kind, nums(t.text)]), `kasus ${n}`).toEqual(old.A.map(oldTip))
  })
})
