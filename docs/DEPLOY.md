# Deploy

Frontend di Cloudflare Pages, backend di Coolify (server yang sama dengan Directus). Keduanya harus satu domain induk, misalnya `app.domain.com` dan `api.domain.com` (PRD bagian 4), supaya cookie login tidak diblokir browser.

## Backend (Coolify)

| Pengaturan | Isi |
| --- | --- |
| Sumber | Repo git, Dockerfile `backend/Dockerfile`, konteks build root repo |
| Port | 3000 |
| Health check | `GET /api/health` |
| Migrasi | Jalan otomatis setiap container menyala, aman diulang |

Variabel lingkungan:

| Nama | Isi |
| --- | --- |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | PostgreSQL yang sama dengan Directus |
| `DIRECTUS_URL`, `DIRECTUS_ADMIN_EMAIL`, `DIRECTUS_ADMIN_PASSWORD` | Directus untuk penyimpanan file |
| `JWT_SECRET` | Teks acak yang panjang, berbeda dari yang dipakai saat pengembangan |
| `FRONTEND_ORIGIN` | Alamat frontend, misalnya `https://app.domain.com` |
| `GROQ_API_KEY`, `GROQ_MODEL` | Pembaca invoice pembelian. Kosong berarti draf diisi manual. |

## Frontend (Cloudflare Pages)

| Pengaturan | Isi |
| --- | --- |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Build output | `dist` |
| `VITE_API_URL` | Alamat backend, misalnya `https://api.domain.com` |
| `NODE_VERSION` | `22` |

Alamat seperti `/akun` dilayani `index.html` otomatis, karena proyek tanpa `404.html` dianggap aplikasi satu halaman oleh Cloudflare Pages.

## Tes

| Perintah | Isi |
| --- | --- |
| `npm test` di `backend` | 80 tes API, termasuk aturan data PRD bagian 18 |
| `npx vitest run` di `frontend` | Tes modul hitung dan aturan tanpa em dash |
| `npm run e2e` di `frontend` | Tes lewat layar untuk semua skenario PRD bagian 13, memakai database `plts_e2e` yang dibangun ulang |
