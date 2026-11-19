import { createRequire } from "node:module"
import { dirname } from "node:path"

// Pembaca isi invoice (PRD 10.1 langkah 3), dipasang sebagai modul terpisah supaya layanannya bisa diganti.
// Layanan: model vision di Groq. Tanpa GROQ_API_KEY, atau kalau pembacaan gagal, hasilnya null dan admin
// mengisi draf secara manual. Alur unggah tetap jalan.
export interface Extraction {
  store_name: string | null; purchase_date: string | null; invoice_number: string | null
  items: { name: string; qty: number; unit_price: number; unit: string | null }[]
  subtotal_products: number; discount: number; shipping: number; shipping_discount: number; other_fees: number; total_paid: number
  raw: unknown // jawaban asli layanan, disimpan di purchases.extraction_raw
}

// Model bisa diganti lewat GROQ_MODEL tanpa ubah kode, karena Groq sering memensiunkan model.
// qwen/qwen3.8-27b masih berstatus Preview di Groq, dan menerima paling banyak 3 gambar per permintaan.
const DEFAULT_MODEL = "qwen/qwen3.8-27b"
const MAX_PAGES = 3

const PROMPT = `You read Indonesian purchase documents: online store receipts (Tokopedia, Shopee, and others) and handwritten shop notes (nota).
All images are pages of ONE purchase. Reply with only this JSON object:
{"store_name": string|null, "purchase_date": "YYYY-MM-DD"|null, "invoice_number": string|null,
 "items": [{"name": string, "qty": number, "unit": string|null, "unit_price": integer|null, "line_total": integer|null}],
 "subtotal_products": integer, "discount": integer, "shipping": integer, "shipping_discount": integer, "other_fees": integer, "total_paid": integer}
Rules:
- Money is whole rupiah as a plain integer: "Rp1.250.000" is 1250000. Use 0 for an amount that is not printed.
- store_name: the seller or shop (Penjual, Toko), not the marketplace and not the buyer.
- purchase_date: the purchase date or the date written on the note. invoice_number: the order, invoice, or faktur number, null if empty.
- items: one entry per product line, name copied as printed. unit only when printed with the quantity (pcs, btg, meter, roll), otherwise null.
  unit_price is the price per unit (Harga Satuan), null if not printed. line_total is the line amount (Total Harga, Jumlah).
- subtotal_products: the product subtotal (Subtotal Harga Produk). If there is no separate subtotal, use the same number as total_paid.
- discount: the sum of all product discounts and vouchers (Diskon produk, Voucher dari platform, Voucher dari penjual), as a positive number.
- shipping: the shipping cost (Total ongkos kirim). shipping_discount: shipping vouchers and discounts (Voucher ongkir, Diskon ongkos kirim), as a positive number.
- other_fees: other charges such as Asuransi pengiriman, Biaya layanan, Biaya jasa aplikasi, Biaya penanganan.
- total_paid: the final amount paid (Total Tagihan, Total Pembayaran, Jumlah Rp).
- A shipping receipt section repeats the shipping cost. Count it once.
- Copy numbers exactly as printed. Never invent or correct them.`

export async function readInvoice(file: { buf: Buffer; mime: string; name: string }): Promise<Extraction | null> {
  const key = process.env.GROQ_API_KEY
  if (!key) return null
  try {
    const images = file.mime === "application/pdf" ? await pdfToPng(file.buf) : [{ mime: file.mime, buf: file.buf }]
    const request = JSON.stringify({
      model: process.env.GROQ_MODEL || DEFAULT_MODEL, temperature: 0, max_completion_tokens: 4096,
      response_format: { type: "json_object" }, reasoning_effort: "none", reasoning_format: "hidden",
      messages: [{ role: "user", content: [{ type: "text", text: PROMPT },
        ...images.map(i => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.buf.toString("base64")}` } }))] }],
    })
    const send = () => fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", body: request,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, signal: AbortSignal.timeout(30_000) })
    let res = await send()
    // Kena batas per menit (paket gratis Groq kira-kira 2 halaman invoice per menit): tunggu sesuai saran Groq, coba sekali lagi.
    // Total waktu dibatasi supaya tetap di bawah batas tunggu 100 detik di Cloudflare.
    const wait = Number(res.headers.get("retry-after"))
    if (res.status === 429 && wait > 0 && wait <= 40) {
      await new Promise(r => setTimeout(r, wait * 1000))
      res = await send()
    }
    const body: any = await res.json()
    if (!res.ok) throw new Error(`Groq ${res.status}: ${body?.error?.message ?? "tanpa pesan"}`)
    return clean(JSON.parse(body.choices[0].message.content))
  } catch (e) {
    console.error(`Pembaca invoice gagal untuk ${file.name}, draf diisi manual: ${(e as Error).message}`)
    return null
  }
}

// Groq hanya menerima gambar, jadi tiap halaman PDF dirender ke PNG. Invoice toko online yang dicetak ke PDF
// biasanya tanpa lapisan teks (tulisannya berupa garis), jadi mengambil teks atau gambar di dalam PDF tidak cukup.
// pdfjs mewajibkan alamat folder berakhiran "/", termasuk di Windows.
const PDFJS = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")).replaceAll("\\", "/")
async function pdfToPng(buf: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const doc = await getDocument({ data: new Uint8Array(buf), isEvalSupported: false, verbosity: 0, cMapPacked: true,
    standardFontDataUrl: `${PDFJS}/standard_fonts/`, cMapUrl: `${PDFJS}/cmaps/`, wasmUrl: `${PDFJS}/wasm/` }).promise
  try {
    if (doc.numPages > MAX_PAGES) throw new Error(`PDF ${doc.numPages} halaman, paling banyak ${MAX_PAGES}`)
    const out = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale: 2 })
      const { canvas, context } = (doc as any).canvasFactory.create(viewport.width, viewport.height)
      await page.render({ canvas, canvasContext: context, viewport }).promise
      out.push({ mime: "image/png", buf: canvas.toBuffer("image/png") as Buffer })
    }
    return out
  } finally {
    await doc.destroy()
  }
}

// Jawaban model tidak dipercaya begitu saja: angka dibulatkan dan dibuat positif, isian yang tidak terbaca dikosongkan,
// baris barang yang tidak lengkap dibuang. Pengecekan jumlah (PRD 10.2) yang menandai draf "perlu dicek".
const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 255) : null)
// "Rp1.250.000" atau "-Rp67.000,00" tetap terbaca sebagai rupiah bulat positif.
const money = (x: unknown) => {
  const n = typeof x === "number" ? x : typeof x === "string" && /\d/.test(x) ? Number(x.replace(/[,.]\d{1,2}$/, "").replace(/\D/g, "")) : NaN
  return Number.isFinite(n) ? Math.abs(Math.round(n)) : null
}

export function clean(r: any): Extraction {
  if (!r || typeof r !== "object") throw new Error("jawaban bukan objek JSON")
  const items = (Array.isArray(r.items) ? r.items : []).flatMap((it: any) => {
    const name = text(it?.name), qty = typeof it?.qty === "number" ? it.qty : Number(it?.qty)
    if (!name || !(qty > 0)) return []
    // Nota sering hanya menulis jumlah per baris; harga satuan lalu dihitung dari jumlah dibagi banyaknya.
    const price = money(it.unit_price), total = money(it.line_total), unit_price = price || (total === null ? price : Math.round(total / qty))
    return unit_price === null ? [] : [{ name, qty, unit: text(it.unit), unit_price }]
  })
  const date = text(r.purchase_date)
  return {
    store_name: text(r.store_name), invoice_number: text(r.invoice_number),
    purchase_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date)) ? date : null,
    items, subtotal_products: money(r.subtotal_products) ?? 0, discount: money(r.discount) ?? 0, shipping: money(r.shipping) ?? 0,
    shipping_discount: money(r.shipping_discount) ?? 0, other_fees: money(r.other_fees) ?? 0, total_paid: money(r.total_paid) ?? 0, raw: r,
  }
}
