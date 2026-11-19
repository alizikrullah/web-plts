import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { LuLocateFixed, LuMapPin, LuSearch } from "react-icons/lu"

// Titik lokasi pemasangan di peta OpenStreetMap (gratis, tanpa kunci). Google Maps dipakai lewat tautan untuk navigasi.
export interface Point { lat: number; lng: number }
const START: Point = { lat: -6.9, lng: 107.6 } // Jawa Barat, sebelum titik dipilih
const round = (x: number) => Math.round(x * 1e6) / 1e6
export const googleMaps = (p: Point) => `https://www.google.com/maps?q=${p.lat},${p.lng}`

// Saran alamat sambil mengetik dari Photon (komoot): data OpenStreetMap, gratis tanpa kunci, dengan syarat pemakaian wajar.
// Nominatim melarang saran sambil mengetik, jadi tidak dipakai. Hasil dibatasi ke Indonesia dan diutamakan yang dekat peta.
interface Hit { name: string; detail: string; p: Point; zoom: number }
const ZOOM: Record<string, number> = { house: 18, street: 17, locality: 16, district: 15, city: 13, county: 11, state: 8, country: 5 }
async function suggest(q: string, near: Point, signal: AbortSignal): Promise<Hit[]> {
  const r = await fetch(`https://photon.komoot.io/api/?limit=5&lang=default&bbox=95,-11,141.1,6.1&lat=${near.lat}&lon=${near.lng}&q=${encodeURIComponent(q)}`, { signal })
  if (!r.ok) throw new Error(String(r.status))
  const { features } = (await r.json()) as { features: { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }[] }
  const hits = features.map(({ geometry: { coordinates: [lng, lat] }, properties: o }) => {
    const name = o.name ?? [o.street, o.housenumber].filter(Boolean).join(" ")
    // Urutan alamat Indonesia: jalan, kelurahan, kecamatan, kota, provinsi.
    const detail = [...new Set([o.street, o.district, o.county, o.city, o.state])].filter(x => x && x !== name).join(", ")
    return { name: name || detail, detail, p: { lat: round(lat), lng: round(lng) }, zoom: ZOOM[o.type ?? ""] ?? 17 }
  })
  return hits.filter((h, i) => hits.findIndex(x => x.name === h.name && x.detail === h.detail) === i)
}

export function MapPicker({ value, onChange }: { value: Point | null; onChange?: (p: Point | null) => void }) {
  const box = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), pin = useRef<L.CircleMarker | null>(null)
  const change = useRef(onChange); change.current = onChange
  const [q, setQ] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false)
  const [hits, setHits] = useState<Hit[] | null>(null), [open, setOpen] = useState(false), [active, setActive] = useState(0)
  const listId = useId()

  useEffect(() => {
    const m = L.map(box.current!, { scrollWheelZoom: false }).setView(value ?? START, value ? 16 : 9)
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(m)
    m.on("click", e => change.current?.({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) }))
    map.current = m
    return () => { m.remove(); map.current = null; pin.current = null }
  }, [])
  useEffect(() => {
    pin.current?.remove(); pin.current = null
    if (value && map.current) pin.current = L.circleMarker(value, { radius: 9, color: "#e08a00", weight: 3, fillOpacity: 0.6 }).addTo(map.current)
  }, [value?.lat, value?.lng])

  const go = (p: Point, zoom = 17) => { map.current?.setView(p, zoom); change.current?.(p) }
  function mine() {
    setMsg("")
    if (!navigator.geolocation) return setMsg("Perangkat ini tidak bisa membagikan lokasi.")
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      p => { setBusy(false); go({ lat: round(p.coords.latitude), lng: round(p.coords.longitude) }) },
      () => { setBusy(false); setMsg(window.isSecureContext ? "Lokasi tidak bisa diambil. Izinkan akses lokasi atau ketuk peta." : "Lokasi perangkat hanya bisa dipakai lewat HTTPS. Ketuk titik di peta saja.") },
      { enableHighAccuracy: true, timeout: 15000 })
  }
  // Saran dicari 350 ms setelah berhenti mengetik, minimal 3 huruf. Ketikan yang sudah lewat dibatalkan.
  useEffect(() => {
    const text = q.trim()
    if (!open || text.length < 3) return setHits(null)
    const ctl = new AbortController(), c = map.current?.getCenter() ?? START
    const t = setTimeout(() => suggest(text, { lat: c.lat, lng: c.lng }, ctl.signal).then(h => { setHits(h); setActive(0); setMsg("") },
      e => { if ((e as Error).name !== "AbortError") setMsg("Saran alamat sedang tidak bisa dipakai. Geser peta dan ketuk titiknya saja.") }), 350)
    return () => { clearTimeout(t); ctl.abort() }
  }, [q, open])
  // Memilih saran hanya memindahkan peta. Titik rumah tetap diketuk sendiri supaya tidak jatuh di tengah desa atau kota.
  function pick(h: Hit) {
    setQ(h.name); setOpen(false)
    map.current?.setView(h.p, h.zoom)
  }
  const list = open && hits !== null && q.trim().length >= 3
  function key(e: KeyboardEvent<HTMLInputElement>) {
    const n = hits?.length ?? 0
    if (e.key === "Enter") { e.preventDefault(); if (list && hits![active]) pick(hits![active]) }
    else if (e.key === "Escape") setOpen(false)
    else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) { e.preventDefault(); setOpen(true); setActive(a => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n) }
  }

  return (
    <div className="map-picker">
      <div className="map-tools">
        <div className="map-search">
          <LuSearch aria-hidden />
          <input role="combobox" aria-label="Cari alamat di peta" aria-autocomplete="list" aria-expanded={list} aria-controls={listId}
            aria-activedescendant={list && hits!.length ? `${listId}-${active}` : undefined} autoComplete="off"
            value={q} placeholder="Ketik nama jalan, desa, atau tempat" onKeyDown={key}
            onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} />
          {list && (hits!.length ? (
            <ul id={listId} role="listbox" aria-label="Saran alamat" className="suggest">
              {hits!.map((h, i) => (
                <li key={i} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  onMouseDown={e => e.preventDefault()} onClick={() => pick(h)} onMouseEnter={() => setActive(i)}>
                  <LuMapPin aria-hidden /><span><b>{h.name}</b>{h.detail && <small>{h.detail}</small>}</span>
                </li>
              ))}
            </ul>
          ) : <p id={listId} className="suggest none" role="status">Tidak ada saran. Coba nama jalan, desa, atau kecamatan.</p>)}
        </div>
        <button type="button" className="btn sm" disabled={busy} onClick={mine}><LuLocateFixed aria-hidden />Pakai lokasi saya</button>
      </div>
      <div ref={box} className="map" data-testid="peta" />
      <p className="hint">{value
        ? <>Titik: {value.lat}, {value.lng} · <a href={googleMaps(value)} target="_blank" rel="noreferrer">Buka di Google Maps</a> · <button type="button" className="link" onClick={() => change.current?.(null)}>Hapus titik</button></>
        : "Ketuk peta di lokasi rumah untuk menandai titiknya."}</p>
      {msg && <p className="msg warn">{msg}</p>}
    </div>
  )
}

// Peta lihat saja untuk admin.
export function MapView({ value }: { value: Point | null }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!value) return
    const m = L.map(box.current!, { scrollWheelZoom: false }).setView(value, 16)
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(m)
    L.circleMarker(value, { radius: 9, color: "#e08a00", weight: 3, fillOpacity: 0.6 }).addTo(m)
    return () => { m.remove() }
  }, [value?.lat, value?.lng])
  if (!value) return <p className="sub">Lokasi belum ditandai di peta.</p>
  return (
    <div className="map-picker">
      <div ref={box} className="map small" />
      <a className="btn sm" href={googleMaps(value)} target="_blank" rel="noreferrer">Buka di Google Maps</a>
    </div>
  )
}
