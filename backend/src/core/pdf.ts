import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"

// PDF tagihan (PRD 8.1) dan PDF gabungan invoice pembelian (PRD 10.3) dengan pdf-lib.
const rp = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID")
const num = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 })
// Font standar PDF hanya mengenal huruf Latin dasar; karakter lain diganti tanda tanya.
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?")
const date = (d: string | Date) => new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" })

export interface InvoicePdf {
  business_name: string | null; payment_instructions: string
  number: string; type: "awal" | "tambahan"; issued_at: Date; due_date: string; price_valid_until: string | null
  client: { name: string; whatsapp: string; address: string; city: string }; project: { code: string; name: string }
  items: { type: string; description: string; unit: string | null; qty: number; days: number | null; unit_price: number; subtotal: number }[]
  totals: { parts: number; labor: number; services: number; accommodation: number; total: number }
}
const GROUPS = [["part", "Part", "parts"], ["sdm", "SDM", "labor"], ["jasa", "Jasa", "services"], ["akomodasi", "Akomodasi", "accommodation"]] as const

function writer(doc: PDFDocument, font: PDFFont, bold: PDFFont) {
  let page: PDFPage = doc.addPage([595, 842]), y = 800
  const need = (h: number) => { if (y - h < 50) { page = doc.addPage([595, 842]); y = 800 } }
  const wrap = (text: string, f: PDFFont, size: number, width: number) => {
    const lines: string[] = []
    for (const para of safe(text).split(/\r?\n/)) {
      let line = ""
      for (const word of para.split(" ")) {
        const next = line ? line + " " + word : word
        if (f.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word } else line = next
      }
      lines.push(line)
    }
    return lines
  }
  return {
    text(s: string, o: { x?: number; size?: number; bold?: boolean; width?: number; right?: number } = {}) {
      const f = o.bold ? bold : font, size = o.size ?? 10
      const lines = wrap(s, f, size, o.width ?? 495)
      need(lines.length * (size + 4))
      for (const l of lines) {
        const x = o.right !== undefined ? o.right - f.widthOfTextAtSize(l, size) : o.x ?? 50
        page.drawText(l, { x, y, size, font: f, color: rgb(0.1, 0.1, 0.1) }); y -= size + 4
      }
    },
    row(cells: { s: string; x: number; right?: boolean; bold?: boolean; width?: number; size?: number }[], size = 9) {
      const sz = cells.map(c => c.size ?? size)
      const lines = cells.map((c, i) => wrap(c.s, c.bold ? bold : font, sz[i], c.width ?? 400))
      const h = Math.max(...lines.map((l, i) => l.length * (sz[i] + 3)))
      need(h)
      cells.forEach((c, i) => lines[i].forEach((l, j) => {
        const f = c.bold ? bold : font
        page.drawText(l, { x: c.right ? c.x - f.widthOfTextAtSize(l, sz[i]) : c.x, y: y - j * (sz[i] + 3), size: sz[i], font: f })
      }))
      y -= h + 2
    },
    gap(h = 8) { y -= h },
    line() { need(6); page.drawLine({ start: { x: 50, y: y + 4 }, end: { x: 545, y: y + 4 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) }); y -= 6 },
  }
}

export async function invoicePdf(d: InvoicePdf) {
  const doc = await PDFDocument.create()
  doc.setTitle(`Tagihan ${d.number}`)
  const w = writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold))
  // Kepala seperti contoh dari tim: judul INVOICE besar dan nomor di kanan. Nama usaha boleh kosong.
  w.row([{ s: "INVOICE", x: 50, bold: true, size: 28 }, { s: `No: ${d.number}`, x: 545, right: true, bold: true, size: 11 }])
  if (d.type === "tambahan") w.text("Tagihan tambahan", { bold: true, size: 11 })
  if (d.business_name) w.text(d.business_name, { size: 11 })
  w.gap(14)
  const left: [string, boolean][] = [["Ditagihkan kepada", true], [d.client.name, false], [`WhatsApp ${d.client.whatsapp}`, false], [`${d.client.address}, ${d.client.city}`, false]]
  const right: [string, string][] = [["Tanggal", date(d.issued_at)], ["Jatuh tempo", date(d.due_date)],
    ...(d.price_valid_until ? [["Harga berlaku sampai", date(d.price_valid_until)] as [string, string]] : []), ["Proyek", `${d.project.code} (${d.project.name})`]]
  for (let i = 0; i < Math.max(left.length, right.length); i++) w.row([
    ...(left[i] ? [{ s: left[i][0], x: 50, bold: left[i][1], width: 250 }] : []),
    ...(right[i] ? [{ s: right[i][0], x: 320, bold: true, width: 110 }, { s: right[i][1], x: 545, right: true }] : [])], 10)
  w.gap(16)
  for (const [type, label, key] of GROUPS) {
    const items = d.items.filter(i => i.type === type)
    if (!items.length) continue
    w.text(label, { bold: true, size: 11 })
    w.row([{ s: "Uraian", x: 50, bold: true, width: 230 }, { s: "Jumlah", x: 290, bold: true, width: 110 }, { s: "Harga satuan", x: 470, right: true, bold: true }, { s: "Subtotal", x: 545, right: true, bold: true }])
    for (const i of items) {
      const qty = `${num(i.qty)}${i.unit ? " " + i.unit : type === "sdm" ? " orang" : ""}${i.days !== null ? ` x ${num(i.days)} hari` : ""}`
      w.row([{ s: i.description, x: 50, width: 230 }, { s: qty, x: 290, width: 110 }, { s: rp(i.unit_price), x: 470, right: true }, { s: rp(i.subtotal), x: 545, right: true }])
    }
    w.row([{ s: `Total ${label}`, x: 50, bold: true }, { s: rp(d.totals[key]), x: 545, right: true, bold: true }])
    w.gap(6)
  }
  w.line()
  w.row([{ s: "TOTAL TAGIHAN", x: 50, bold: true }, { s: rp(d.totals.total), x: 545, right: true, bold: true }], 12)
  w.gap(14)
  w.text("Cara pembayaran", { bold: true })
  w.text(d.payment_instructions)
  w.gap()
  w.text("Kebijakan pengembalian", { bold: true })
  w.text("Tagihan dibayar penuh di depan. Biaya part dihitung ulang terhadap invoice pembelian asli dari toko. Kelebihan bayar untuk part dikembalikan ke client, dan rekapnya bisa dilihat di halaman Invoice Pembelian.")
  w.gap(16)
  w.text("Terima kasih.", { bold: true, size: 14 })
  return Buffer.from(await doc.save())
}

// Menyatukan file invoice pembelian (PDF, JPG, PNG) menjadi satu PDF.
// File yang rusak tidak menggagalkan semuanya: diganti satu halaman keterangan.
export async function mergePdf(files: { buf: Buffer; mime: string; name: string }[]) {
  const doc = await PDFDocument.create()
  for (const f of files) {
    try {
      if (f.mime === "application/pdf") {
        const src = await PDFDocument.load(f.buf, { ignoreEncryption: true })
        for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p)
      } else {
        const img = f.mime === "image/png" ? await doc.embedPng(f.buf) : await doc.embedJpg(f.buf)
        const scale = Math.min(1, 535 / img.width, 782 / img.height)
        const page = doc.addPage([595, 842])
        page.drawImage(img, { x: (595 - img.width * scale) / 2, y: (842 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale })
      }
    } catch {
      const page = doc.addPage([595, 842])
      page.drawText(safe(`File "${f.name}" tidak bisa digabung. Buka file aslinya dari tabel.`), { x: 50, y: 790, size: 11, font: await doc.embedFont(StandardFonts.Helvetica) })
    }
  }
  if (!doc.getPageCount()) doc.addPage([595, 842])
  return Buffer.from(await doc.save())
}
