-- Titik lokasi pemasangan dari peta (permintaan tim 17 Nov 2026). Boleh kosong; kalau diisi, keduanya terisi bersamaan.
alter table projects add column latitude numeric, add column longitude numeric;
alter table projects add constraint projects_lokasi check (
  (latitude is null) = (longitude is null)
  and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180)));
