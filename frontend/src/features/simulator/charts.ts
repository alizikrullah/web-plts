import type { Fin, Sim } from "../../../../shared/calc/rumah"
import { rpS } from "../../../../shared/format"

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()

function setup(cv: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight
  cv.width = w * dpr; cv.height = h * dpr
  const x = cv.getContext("2d")!
  x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h)
  x.font = "11px " + css("--font"); x.lineWidth = 1
  return { x, w, h }
}

export function drawDay(cv: HTMLCanvasElement, sim: Sim) {
  const { x, w, h } = setup(cv), L = 40, R = 34, T = 10, B = 24, pw = w - L - R, ph = h - T - B
  const muted = css("--muted"), line = css("--line"), fg = css("--fg"), acc = css("--accent"), teal = css("--teal")
  const { pv, load, soc } = sim.prof, N = pv.length
  let maxW = Math.max(...pv, ...load, 100)
  const stepK = maxW > 2500 ? 1000 : 500
  maxW = Math.ceil(maxW / stepK) * stepK
  x.fillStyle = muted; x.strokeStyle = line; x.textAlign = "right"
  for (let v = 0; v <= maxW; v += stepK) {
    const y = T + ph - v / maxW * ph
    x.beginPath(); x.moveTo(L, y); x.lineTo(L + pw, y); x.stroke()
    x.fillText((v / 1000).toLocaleString("id-ID") + " kW", L - 4, y + 4)
  }
  if (sim.cap > 0) {
    x.fillStyle = teal; x.textAlign = "left"
    for (const s of [0, 50, 100]) x.fillText(s + "%", L + pw + 4, T + ph - s / 100 * ph + 4)
  }
  x.fillStyle = muted; x.textAlign = "center"
  for (let hh = 0; hh <= 24; hh += 6) x.fillText(String(hh).padStart(2, "0"), L + hh / 24 * pw, h - 6)
  const X = (i: number) => L + (i + 0.5) / N * pw, Yw = (v: number) => T + ph - v / maxW * ph, Ys = (v: number) => T + ph - v / 100 * ph
  const path = (vals: number[], Y: (v: number) => number) => { x.beginPath(); vals.forEach((v, i) => (i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)))) }
  path(pv, Yw); x.lineTo(X(N - 1), Yw(0)); x.lineTo(X(0), Yw(0)); x.closePath()
  x.globalAlpha = 0.25; x.fillStyle = acc; x.fill(); x.globalAlpha = 1
  path(pv, Yw); x.strokeStyle = acc; x.lineWidth = 2; x.stroke()
  path(load, Yw); x.strokeStyle = fg; x.lineWidth = 1.5; x.stroke()
  if (sim.cap > 0) { path(soc, Ys); x.strokeStyle = teal; x.lineWidth = 2; x.setLineDash([5, 3]); x.stroke(); x.setLineDash([]) }
}

export function drawCash(cv: HTMLCanvasElement, fin: Fin) {
  const { x, w, h } = setup(cv), L = 52, R = 8, T = 10, B = 24, pw = w - L - R, ph = h - T - B
  const muted = css("--muted"), line = css("--line"), good = css("--good"), bad = css("--bad"), fg = css("--fg")
  const c = fin.cum, N = c.length
  let mx = Math.max(...c, 0), mn = Math.min(...c, 0)
  const raw = (mx - mn || 1) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / mag > 5 ? 5 : raw / mag > 2 ? 2 : 1
  const st = Math.ceil(raw / mag / m) * m * mag
  mn = Math.floor(mn / st) * st; mx = Math.ceil(mx / st) * st
  const Y = (v: number) => T + ph - (v - mn) / (mx - mn) * ph
  x.textAlign = "right"
  for (let v = mn; v <= mx + 1; v += st) {
    const y = Y(v)
    x.strokeStyle = v === 0 ? fg : line; x.globalAlpha = v === 0 ? 0.6 : 1
    x.beginPath(); x.moveTo(L, y); x.lineTo(L + pw, y); x.stroke(); x.globalAlpha = 1
    x.fillStyle = muted; x.fillText(rpS(v).replace("Rp", ""), L - 4, y + 4)
  }
  const bw = pw / N
  c.forEach((v, i) => {
    const y0 = Y(0), y = Y(v)
    x.fillStyle = v < 0 ? bad : good
    x.fillRect(L + i * bw + bw * 0.18, Math.min(y, y0), bw * 0.64, Math.max(1, Math.abs(y - y0)))
  })
  x.fillStyle = muted; x.textAlign = "center"
  const lab = N > 16 ? 5 : N > 8 ? 2 : 1
  for (let i = 0; i < N; i += lab) x.fillText(String(i), L + i * bw + bw / 2, h - 6)
}
