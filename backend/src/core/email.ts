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

export interface MailContent {
  preheader: string // ringkasan yang tampil di daftar inbox
  title: string; greeting: string; paragraphs: string[]
  button: { url: string; label: string }
  expires: string // misalnya "Link berlaku 24 jam dan hanya bisa dipakai sekali."
  footnote: string // misalnya "Kalau Anda tidak merasa mendaftar, abaikan email ini."
}

// Email bermerek PLTS Rumah: kepala berwarna, judul, tombol besar, masa berlaku link, dan kaki email.
// Memakai tabel dan gaya inline supaya tampil sama di Gmail, Outlook, dan aplikasi email di HP.
export function mail(to: string, subject: string, c: MailContent): Mail {
  const text = [c.greeting, ...c.paragraphs, `${c.button.label}: ${c.button.url}`, c.expires, c.footnote, "PLTS Rumah"].join("\n\n")
  const font = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef2f1">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f1;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dfe6e4">
<tr><td style="background:#17323a;padding:22px 32px;${font}">
<span style="font-size:24px;line-height:1;color:#eb9a1e;vertical-align:middle">&#9728;</span>
<span style="font-size:18px;font-weight:800;color:#eef5f3;vertical-align:middle;padding-left:6px">PLTS Rumah</span>
</td></tr>
<tr><td style="height:4px;background:#eb9a1e;line-height:4px;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:32px 32px 8px;${font};color:#172220">
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;font-weight:800;color:#172220">${esc(c.title)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${esc(c.greeting)}</p>
${c.paragraphs.map(p => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#33413f">${esc(p)}</p>`).join("\n")}
</td></tr>
<tr><td align="center" style="padding:16px 32px 8px">
<a href="${esc(c.button.url)}" style="display:inline-block;padding:15px 34px;background:#eb9a1e;color:#1e1505;border-radius:12px;text-decoration:none;${font};font-size:16px;font-weight:800">${esc(c.button.label)}</a>
</td></tr>
<tr><td align="center" style="padding:6px 32px 24px;${font};font-size:13px;color:#5c6b68">&#9201; ${esc(c.expires)}</td></tr>
<tr><td style="padding:0 32px"><div style="border-top:1px solid #e6ecea"></div></td></tr>
<tr><td style="padding:18px 32px 28px;${font};font-size:12.5px;line-height:1.6;color:#6b7a77">
${esc(c.footnote)}<br><br>Tombol tidak bisa diklik? Salin alamat ini ke browser:<br>
<a href="${esc(c.button.url)}" style="color:#1f6f6a;word-break:break-all">${esc(c.button.url)}</a>
</td></tr>
</table>
<p style="margin:18px 0 0;${font};font-size:12px;color:#8a9794">Email ini dikirim otomatis oleh PLTS Rumah. Mohon tidak membalas email ini.</p>
</td></tr>
</table>
</body></html>`
  return { to, subject, text, html }
}
