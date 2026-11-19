-- Pembelian terkonfirmasi tidak dihapus atau diubah (PRD bagian 12). Koreksi dilakukan dengan catatan baru.
create function forbid_confirmed_purchase_change() returns trigger language plpgsql as $$
declare
  pid uuid;
begin
  if tg_table_name = 'purchases' then
    if old.status = 'terkonfirmasi' then
      raise exception 'Pembelian terkonfirmasi tidak boleh diubah atau dihapus' using errcode = 'P0001';
    end if;
  else
    pid := case when tg_op = 'INSERT' then new.purchase_id else old.purchase_id end;
    if exists (select 1 from purchases where id = pid and status = 'terkonfirmasi') then
      raise exception 'Barang di pembelian terkonfirmasi tidak boleh diubah atau dihapus' using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger purchases_tetap before update or delete on purchases for each row execute function forbid_confirmed_purchase_change();
create trigger purchase_items_tetap before insert or update or delete on purchase_items for each row execute function forbid_confirmed_purchase_change();
