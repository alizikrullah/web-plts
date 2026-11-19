-- Riwayat status tidak diubah atau dihapus (PRD 9.3 dan 12, aturan 18.5).
create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'Riwayat di tabel % tidak boleh diubah atau dihapus', tg_table_name using errcode = 'P0001';
end $$;

create trigger status_updates_tetap before update or delete on status_updates for each row execute function forbid_change();
create trigger status_update_photos_tetap before update or delete on status_update_photos for each row execute function forbid_change();
