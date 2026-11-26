# Daftar endpoint backend

Diturunkan dari halaman di PRD, ditulis di tahap B1 sebelum kode endpoint dibuat (PRD bagian 19.3). Kalau ada yang berubah saat tahapnya dikerjakan, daftar ini ikut diperbarui.

Aturan umum:

- Semua alamat berawalan `/api`. Isi kiriman dan jawaban berbentuk JSON, kecuali unggah dan unduh file.
- Akses: **Publik** = tanpa login. **Login** = semua role. **Guest/Client** = guest dan client. **Client** = pemilik proyek, admin juga boleh. **Admin** = admin saja.
- Access token dikirim di header `Authorization: Bearer`. Refresh token ada di cookie httpOnly.
- Endpoint berawalan `/api/admin` selalu menolak selain admin.
- Endpoint proyek untuk client selalu difilter dengan id user dari token (aturan 18.1). Proyek orang lain dijawab 404.
- Angka uang selalu dihitung ulang di backend.

## B1. Fondasi

| Metode | Alamat | Akses | Guna |
| --- | --- | --- | --- |
| GET | `/api/health` | Publik | Cek backend dan database hidup |

## B2. Akun dan izin akses

| Metode | Alamat | Akses | Guna |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | Publik | Daftar: nama, email, WhatsApp, password. Selalu menjadi guest. Mengirim link verifikasi email; belum bisa masuk sebelum link diklik. |
| POST | `/api/auth/verify-email` | Publik | Verifikasi email dengan token dari link (berlaku 24 jam, sekali pakai) |
| POST | `/api/auth/resend-verification` | Publik | Kirim ulang link verifikasi, paling cepat sekali per menit. Jawaban selalu sama. |
| POST | `/api/auth/forgot-password` | Publik | Kirim link reset password (berlaku 1 jam). Jawaban selalu sama. |
| POST | `/api/auth/reset-password` | Publik | Simpan password baru dari link reset dan cabut semua sesi lama |
| POST | `/api/auth/login` | Publik | Masuk. Dibatasi 5 kali gagal per 15 menit per email. Email yang belum diverifikasi ditolak. |
| POST | `/api/auth/refresh` | Cookie | Minta access token baru |
| POST | `/api/auth/logout` | Login | Keluar dan cabut refresh token |
| GET | `/api/me` | Login | Data akun dan role terbaru dari database |
| PATCH | `/api/me` | Login | Ubah nama dan nomor WhatsApp |
| POST | `/api/me/password` | Login | Ganti password. Wajib setelah memakai password sementara. |
| GET | `/api/admin/users` | Admin | Daftar akun, bisa dicari |
| POST | `/api/admin/users` | Admin | Buat akun admin |
| PATCH | `/api/admin/users/:id` | Admin | Nonaktifkan atau aktifkan lagi. Nonaktif mencabut refresh token. |
| POST | `/api/admin/users/:id/role` | Admin | Jadikan guest tanpa proyek sebagai admin, atau turunkan admin menjadi guest. Tidak untuk akun sendiri. |
| DELETE | `/api/admin/users/:id` | Admin | Hapus akun yang belum punya proyek atau catatan lain, beserta simulasinya. Tidak untuk akun sendiri. |
| POST | `/api/admin/users/:id/temp-password` | Admin | Buat password sementara |

## B3. List Part dan Pengaturan

| Metode | Alamat | Akses | Guna |
| --- | --- | --- | --- |
| GET | `/api/parts` | Publik | Panel, inverter, dan baterai yang aktif, ditambah aksesoris aktif yang punya aturan jumlah. Hanya nama, kategori, satuan, harga satuan, kelas paket, angka teknis, dan aturan jumlah aksesoris. |
| GET | `/api/admin/parts` | Admin | Semua part dengan semua kolom, bisa difilter |
| GET | `/api/admin/parts/:id` | Admin | Satu part dengan semua kolom, untuk halaman ubah part |
| POST | `/api/admin/parts` | Admin | Tambah part |
| PATCH | `/api/admin/parts/:id` | Admin | Ubah part, termasuk nonaktifkan. Ubah harga memperbarui tanggal harga. |
| GET | `/api/settings/public` | Publik | Nomor WhatsApp, area layanan, FAQ, dan nilai bawaan Simulator |
| GET | `/api/admin/settings` | Admin | Semua pengaturan |
| PUT | `/api/admin/settings/:key` | Admin | Ubah satu pengaturan |
| GET | `/api/admin/faqs` | Admin | Daftar FAQ |
| POST | `/api/admin/faqs` | Admin | Tambah FAQ |
| PATCH | `/api/admin/faqs/:id` | Admin | Ubah, urutkan, atau nonaktifkan FAQ |
| GET | `/api/admin/statuses` | Admin | Status utama beserta sub-statusnya |
| POST | `/api/admin/statuses` | Admin | Tambah status utama |
| PATCH | `/api/admin/statuses/:id` | Admin | Ganti nama, urutan, atau nonaktifkan |
| POST | `/api/admin/statuses/:id/sub-statuses` | Admin | Tambah sub-status |
| PATCH | `/api/admin/sub-statuses/:id` | Admin | Ganti nama, urutan, atau nonaktifkan |

Impor data awal part dari sheet dijalankan sebagai skrip, bukan endpoint.

## B4. Simulator

Hitungan memakai satu modul yang sama di frontend dan backend. Pengunjung menghitung di browser tanpa menyimpan ke server.

| Metode | Alamat | Akses | Guna |
| --- | --- | --- | --- |
| POST | `/api/simulations` | Guest/Client | Simpan simulasi hybrid atau on-grid (`system_type`). Backend menghitung ulang dan menyalin harga, estimasi aksesoris, estimasi jasa, dan umur baterai saat itu. `package_tier` hanya tercatat kalau konfigurasinya persis paket itu. |
| GET | `/api/simulations` | Guest/Client | Simulasi milik sendiri |
| GET | `/api/simulations/:id` | Pemilik, Admin | Satu simulasi dengan hasilnya |

## B5. Pengajuan, proyek, dan status

| Metode | Alamat | Akses | Guna |
| --- | --- | --- | --- |
| POST | `/api/simulations/:id/submit` | Guest/Client | Ajukan perhitungan detail: alamat, kota, catatan. Membuat proyek berstatus Pengajuan dan mengunci simulasi. |
| GET | `/api/home/stats` | Publik | Angka bukti: jumlah proyek selesai dan total kWp |
| GET | `/api/home` | Guest/Client | Data kartu Langkah berikutnya dan dashboard client |
| GET | `/api/projects` | Client | Proyek milik sendiri |
| GET | `/api/projects/:id/status` | Client | Status sekarang, riwayat dengan foto, dan tagihan yang sudah terbit |
| GET | `/api/files/:id` | Pemilik proyek, Admin | Buka file setelah cek pemilik. File pembelian baru setelah terkonfirmasi, file tagihan baru setelah terbit. |
| POST | `/api/admin/projects/:id/files?purpose=` | Admin | Unggah satu file (PDF, JPG, PNG, maksimal 10 MB). Isi kiriman adalah file mentah, `Content-Type` jenis file, `X-Filename` nama file. Hasilnya id file yang dipakai endpoint lain (foto status, bukti bayar, bukti setuju, bukti pengembalian, invoice pembelian). |
| GET | `/api/admin/home/status-bulanan` | Admin | Tabel Status Client per bulan |
| GET | `/api/admin/home/perlu-tindakan` | Admin | Antrian Perlu Tindakan |
| GET | `/api/admin/projects` | Admin | Daftar proyek, bisa dicari dan difilter per status |
| POST | `/api/admin/projects` | Admin | Client atau proyek baru, langsung di status Planning |
| GET | `/api/admin/projects/:id` | Admin | Detail proyek |
| PATCH | `/api/admin/projects/:id` | Admin | Ubah penanggung jawab, perkiraan selesai, dan kWp terpasang |
| POST | `/api/admin/projects/:id/accept` | Admin | Terima pengajuan: role naik, proyek ke Planning |
| POST | `/api/admin/projects/:id/reject` | Admin | Tolak pengajuan dengan alasan |
| POST | `/api/admin/projects/:id/status-updates` | Admin | Update status, catatan, dan foto |

## B6. Planning dan tagihan

| Metode | Alamat | Akses | Guna |
| --- | --- | --- | --- |
| GET | `/api/admin/projects/:id/planning` | Admin | Planning dan baris biayanya |
| PUT | `/api/admin/projects/:id/planning` | Admin | Simpan planning draf beserta baris biaya |
| POST | `/api/admin/projects/:id/planning/finalize` | Admin | Jadikan final dan isi tanggal harga berlaku |
| POST | `/api/admin/projects/:id/planning/reopen` | Admin | Kembalikan ke draf selama tagihan belum terbit |
| GET | `/api/admin/projects/:id/invoices` | Admin | Tagihan proyek dan pembayarannya |
| GET | `/api/admin/projects/:id/invoices/preview` | Admin | Pratinjau PDF tagihan awal, persis seperti yang diterima client. Tidak menyimpan apa pun. |
| POST | `/api/admin/projects/:id/invoices` | Admin | Terbitkan tagihan awal dari Planning final, dengan PDF (part rinci, sisanya satu baris Biaya Jasa) |
| POST | `/api/admin/invoices/:id/cancel` | Admin | Batalkan tagihan yang belum dibayar |
| POST | `/api/admin/invoices/:id/payments` | Admin | Catat pembayaran dengan bukti |
| GET | `/api/admin/home/tagihan` | Admin | Ringkasan Tagihan dan Pembayaran per bulan |

## B7. Pembelian dan rekap

| Metode | Alamat | Akses | Guna |
| --- | --- | --- | --- |
| GET | `/api/admin/projects/:id/purchases` | Admin | Semua pembelian, termasuk draf |
| POST | `/api/admin/projects/:id/purchases` | Admin | Buat pembelian dari satu file yang sudah diunggah, atau isi manual. File dibaca otomatis lewat Groq kalau `GROQ_API_KEY` diisi. Isian yang dikirim admin menimpa hasil baca. Hasilnya selalu draf. |
| PATCH | `/api/admin/purchases/:id` | Admin | Koreksi draf dan barangnya |
| POST | `/api/admin/purchases/:id/confirm` | Admin | Konfirmasi pembelian |
| GET | `/api/projects/:id/purchases` | Client | Pembelian terkonfirmasi dan rekap akhir |
| GET | `/api/projects/:id/purchases/gabungan.pdf` | Client | Unduh gabungan semua file invoice |
| GET | `/api/admin/projects/:id/cost-adjustments` | Admin | Daftar Biaya Tambahan |
| POST | `/api/admin/projects/:id/cost-adjustments` | Admin | Catat Biaya Tambahan |
| PATCH | `/api/admin/cost-adjustments/:id` | Admin | Isi bukti setuju client |
| GET | `/api/admin/projects/:id/invoices/tambahan/preview?ids=` | Admin | Pratinjau PDF tagihan tambahan untuk Biaya Tambahan terpilih (id dipisah koma). Tidak menyimpan apa pun. |
| POST | `/api/admin/projects/:id/invoices/tambahan` | Admin | Buat tagihan tambahan dari Biaya Tambahan yang sudah disetujui |
| POST | `/api/admin/projects/:id/refunds` | Admin | Catat pengembalian |

Menutup proyek memakai `POST /api/admin/projects/:id/status-updates` dengan status Selesai. Syarat Selesai (aturan 18.10) dicek di sana.

## Skrip (bukan endpoint)

| Perintah | Guna |
| --- | --- |
| `npm run migrate` | Membuat atau memperbarui tabel dari `backend/migrations` |
| `npm run directus:setup` | Mendaftarkan tabel ke Directus dan membuat role "Tim (lihat saja)" |
| `npm run seed` | Data awal: nilai awal Pengaturan dan enam status bawaan |
| `npm run seed:admin -- "Nama" email nomor-wa` | Admin pertama dengan password sementara |
| `npm run import:parts -- data/parts-awal.json` | Impor data awal List Part |
| `npm run import:parts -- data/parts-ongrid.json` | Impor data awal on-grid dari RAB tim (inverter, panel, dan aksesoris dengan aturan jumlah) |
| `npm run seed:contoh` | Data contoh di database terpisah `plts_contoh` untuk tampilan frontend |
