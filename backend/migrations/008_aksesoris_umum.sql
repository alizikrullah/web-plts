-- Aksesoris berlaku untuk semua jenis sistem; hanya inverter yang punya jenis sistem (keputusan tim 25 Nov 2026, PRD 11.1).
update parts set system_type = null where category = 'aksesoris';
alter table parts drop constraint parts_jenis_sistem;
alter table parts add constraint parts_jenis_sistem check ((system_type is not null) = (category = 'inverter'));
