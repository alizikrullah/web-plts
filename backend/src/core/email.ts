import { fail } from "./http.js"

// Email verifikasi dan lupa password lewat Resend. Tanpa RESEND_API_KEY (tes dan pengembangan), email tidak dikirim:
// disimpan di outbox dan linknya dicetak di log supaya tetap bisa diklik.
export interface Mail { to: string; subject: string; text: string; html: string }
export const outbox: Mail[] = []

export async function sendMail(m: Mail) {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    outbox.push(m)
    if (outbox.length > 200) outbox.shift()
    if (!process.env.VITEST) console.log(`[email tidak dikirim, RESEND_API_KEY kosong] ${m.to}: ${m.subject}\n${m.text}`)
    return
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || "PLTS Rumah <no-reply@grivilabs.my.id>", to: [m.to], subject: m.subject, text: m.text, html: m.html }),
  }).catch(() => null)
  if (!r?.ok) {
    console.error("Kirim email gagal:", r?.status, await r?.text().catch(() => ""))
    fail(502, "Email gagal dikirim. Coba lagi beberapa saat lagi.", "EMAIL_FAILED")
  }
}

// Link di email mengarah ke frontend, yaitu alamat pertama di FRONTEND_ORIGIN.
export const appUrl = (path: string) =>
  (process.env.FRONTEND_ORIGIN || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "") + path

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

// Isi email sederhana: beberapa paragraf, satu tombol, dan alamat link yang bisa disalin.
export function mail(to: string, subject: string, paragraphs: string[], link: { url: string; label: string }): Mail {
  const text = [...paragraphs, `${link.label}: ${link.url}`].join("\n\n")
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#172220;max-width:520px">
${paragraphs.map(p => `<p>${esc(p)}</p>`).join("\n")}
<p><a href="${esc(link.url)}" style="display:inline-block;padding:10px 18px;background:#eb9a1e;color:#1e1505;border-radius:8px;text-decoration:none;font-weight:bold">${esc(link.label)}</a></p>
<p style="color:#5c6b68;font-size:13px">Kalau tombol tidak bisa diklik, salin alamat ini ke browser:<br>${esc(link.url)}</p>
</div>`
  return { to, subject, text, html }
}
