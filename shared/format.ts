// Format angka Indonesia: titik = ribuan, koma = desimal.
export const rp = (v: number) => "Rp" + Math.round(v).toLocaleString("id-ID")
export const rpS = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? "-" : ""
  if (a >= 1e9) return s + "Rp" + (a / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " M"
  if (a >= 1e6) return s + "Rp" + (a / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " jt"
  if (a >= 1e3) return s + "Rp" + Math.round(a / 1e3).toLocaleString("id-ID") + " rb"
  return s + "Rp" + Math.round(a)
}
export const n1 = (v: number, d = 1) => v.toLocaleString("id-ID", { maximumFractionDigits: d, minimumFractionDigits: d })
export const fmtNum = (v: number) => v.toLocaleString("id-ID", { maximumFractionDigits: 3 })
export const bepTxt = (b: number | null) => (b === null ? "> umur" : b < 1 ? n1(b * 12, 0) + " bln" : n1(b, 1) + " th")

export function parseNum(str: string) {
  let t = String(str).trim().replace(/\s|Rp/gi, "")
  if (!t) return 0
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".")
  else if (!/^\d+\.(\d{1,2}|\d{4,})$/.test(t)) t = t.replace(/\./g, "") // titik dibaca desimal hanya bila 1-2 atau 4+ digit, mis. 25.6
  const v = parseFloat(t)
  return isFinite(v) ? v : 0
}

// Format saat mengetik, plus posisi kursor barunya.
// dotIsDecimal: titik yang baru diketik di akhir jadi koma desimal (keypad HP tanpa koma).
// Kolom bernilai ribuan memakai false, supaya titik ribuan yang diketik manual ("1.500") tidak terbaca 1,5.
export function liveFormat(old: string, caret: number, dotIsDecimal: boolean) {
  const src = dotIsDecimal && old.endsWith(".") && !old.includes(",") && old.split(".").length === 2 ? old.slice(0, -1) + "," : old
  const raw = src.replace(/[^\d,.]/g, "")
  const ci = raw.indexOf(",")
  const ip = (ci >= 0 ? raw.slice(0, ci) : raw).replace(/[.,]/g, "").replace(/^0+(?=\d)/, "")
  const dp = ci >= 0 ? "," + raw.slice(ci + 1).replace(/[.,]/g, "") : ""
  const value = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + dp
  if (value === old) return { value, caret }
  const keep = src.slice(0, caret).replace(/[^\d,]/g, "").length
  let pos = 0
  for (let c = 0; pos < value.length && c < keep; pos++) if (/[\d,]/.test(value[pos])) c++
  return { value, caret: pos }
}
