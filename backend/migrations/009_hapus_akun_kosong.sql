-- Aturan 18.3 diubah (keputusan tim 26 Nov 2026): akun boleh dihapus permanen hanya kalau belum punya data.
-- Kunci hapus di tabel users dilepas; akun yang masih dirujuk tabel lain (proyek, tagihan, catatan) tetap tertahan oleh FK.
-- parts, project_statuses, dan project_sub_statuses tetap tidak bisa dihapus.
drop trigger users_no_delete on users;
