-- Aturan 18.3: users, parts, project_statuses, dan project_sub_statuses tidak boleh dihapus permanen.
-- Dijaga di database supaya berlaku juga untuk akses di luar backend.
create function forbid_delete() returns trigger language plpgsql as $$
begin
  raise exception 'Data di tabel % tidak boleh dihapus, nonaktifkan saja', tg_table_name using errcode = 'P0001';
end $$;

create trigger users_no_delete before delete on users for each row execute function forbid_delete();
create trigger parts_no_delete before delete on parts for each row execute function forbid_delete();
create trigger project_statuses_no_delete before delete on project_statuses for each row execute function forbid_delete();
create trigger project_sub_statuses_no_delete before delete on project_sub_statuses for each row execute function forbid_delete();
