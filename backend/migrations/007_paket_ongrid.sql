-- Paket budget dan on-grid (keputusan tim 25 Nov 2026, PRD bagian 6, 11, dan 17). Semua kolom baru boleh kosong,
-- jadi data lama tetap sah dan backend lama tetap jalan selama deploy.

alter table parts
  add column package_tier varchar(255) check (package_tier in ('hemat', 'standar', 'premium')),
  add column isc numeric check (isc > 0),
  add column pv_current_max numeric check (pv_current_max > 0),
  add column cycle_life integer check (cycle_life > 0),
  add column qty_basis varchar(255) check (qty_basis in ('per_sistem', 'per_string', 'per_panel')),
  add column qty_per_basis numeric check (qty_per_basis > 0);

-- system_type sekarang juga dipakai aksesoris (boleh kosong, berarti dua jenis sistem), jadi dikeluarkan dari hitungan kolom inverter.
alter table parts drop constraint parts_kolom_inverter;
alter table parts add constraint parts_kolom_inverter check (num_nonnulls(rated_w, pv_max_w, pv_voc_max, mppt_v_min, mppt_v_max, efficiency_pct)
  = case when category = 'inverter' then 6 else 0 end);
alter table parts add constraint parts_jenis_sistem check (case
  when category = 'inverter' then system_type is not null
  when category = 'aksesoris' then true
  else system_type is null end);
alter table parts add constraint parts_kolom_tambahan check (
  (package_tier is null or category in ('panel', 'inverter', 'baterai'))
  and (isc is null or category = 'panel')
  and (pv_current_max is null or category = 'inverter')
  and (cycle_life is null or category = 'baterai')
  and (qty_basis is null or category = 'aksesoris')
  and ((qty_basis is null) = (qty_per_basis is null)));

alter table simulations add column package_tier varchar(255) check (package_tier in ('hemat', 'standar', 'premium'));

-- Nilai awal Pengaturan baru (PRD 11.3). Kunci lama installation_estimate dan battery_replace_year dibiarkan supaya
-- backend lama tetap jalan selama deploy; backend baru tidak memakainya lagi.
insert into settings (key, value) values
  ('panel_wp_per_va', '1'),
  ('battery_max_life_years', '10'),
  ('service_base', '1000000'),
  ('service_per_kwp', '2000000')
on conflict (key) do nothing;
