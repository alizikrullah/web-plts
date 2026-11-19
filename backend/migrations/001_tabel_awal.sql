-- Semua tabel MVP sesuai PRD bagian 17. Nama tabel dan kolom harus persis.
-- Tipe: PK/FK uuid, varchar(255), numeric, timestamptz, jsonb, enum = varchar + CHECK.

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- 17.1 Akun dan data induk

create table users (
  id uuid primary key default gen_random_uuid(),
  name varchar(255) not null,
  email varchar(255) not null unique check (email = lower(email)),
  whatsapp varchar(255) not null,
  password_hash varchar(255) not null,
  must_change_password boolean not null default false,
  role varchar(255) not null default 'guest' check (role in ('guest', 'client', 'admin')),
  is_active boolean not null default true,
  became_client_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated_at before update on users for each row execute function set_updated_at();

create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users,
  token_hash varchar(255) not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on refresh_tokens (user_id);

create table login_attempts (
  id uuid primary key default gen_random_uuid(),
  email varchar(255) not null,
  attempted_at timestamptz not null default now()
);
create index on login_attempts (email, attempted_at);

create table parts (
  id uuid primary key default gen_random_uuid(),
  category varchar(255) not null check (category in ('panel', 'inverter', 'baterai', 'aksesoris')),
  name varchar(255) not null,
  unit varchar(255) not null,
  unit_price bigint not null,
  store_name varchar(255),
  buy_url text,
  price_updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  notes text,
  wp integer,
  voc numeric,
  vmp numeric,
  system_type varchar(255) check (system_type in ('hybrid_offgrid', 'on_grid')),
  rated_w integer,
  pv_max_w integer,
  pv_voc_max numeric,
  mppt_v_min numeric,
  mppt_v_max numeric,
  efficiency_pct numeric,
  battery_system_v integer check (battery_system_v in (12, 24, 48)),
  capacity_ah numeric,
  voltage_v numeric,
  dod_pct numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- kolom teknis wajib untuk kategorinya, kosong untuk kategori lain
  constraint parts_kolom_panel check (num_nonnulls(wp, voc, vmp) = case when category = 'panel' then 3 else 0 end),
  constraint parts_kolom_inverter check (num_nonnulls(system_type, rated_w, pv_max_w, pv_voc_max, mppt_v_min, mppt_v_max, efficiency_pct)
    = case when category = 'inverter' then 7 else 0 end),
  constraint parts_kolom_baterai check (num_nonnulls(capacity_ah, voltage_v, dod_pct) = case when category = 'baterai' then 3 else 0 end),
  constraint parts_kelas_tegangan check (case
    when category = 'baterai' or (category = 'inverter' and system_type = 'hybrid_offgrid') then battery_system_v is not null
    when category = 'inverter' then true
    else battery_system_v is null end)
);
create trigger parts_updated_at before update on parts for each row execute function set_updated_at();

create table project_statuses (
  id uuid primary key default gen_random_uuid(),
  name varchar(255) not null,
  system_key varchar(255) unique check (system_key in ('pengajuan', 'planning', 'menunggu_pembayaran', 'on_progress', 'selesai', 'ditolak')),
  show_to_client boolean not null,
  sort_order integer not null,
  is_active boolean not null default true
);

create table project_sub_statuses (
  id uuid primary key default gen_random_uuid(),
  status_id uuid not null references project_statuses,
  name varchar(255) not null,
  sort_order integer not null,
  is_active boolean not null default true,
  unique (id, status_id) -- supaya sub-status bisa diikat ke status utamanya lewat FK
);
create index on project_sub_statuses (status_id);

create table settings (
  key varchar(255) primary key,
  value jsonb not null,
  updated_by uuid references users,
  updated_at timestamptz not null default now()
);
create trigger settings_updated_at before update on settings for each row execute function set_updated_at();

create table faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  sort_order integer not null,
  is_active boolean not null default true
);

-- 17.2 Simulasi dan proyek

create table simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users,
  system_type varchar(255) not null check (system_type in ('hybrid_offgrid', 'on_grid')),
  panel_part_id uuid not null references parts,
  panel_qty integer not null,
  panel_series integer not null,
  panel_parallel integer not null,
  inverter_part_id uuid not null references parts,
  battery_part_id uuid references parts,
  battery_qty integer not null default 0 check (battery_qty >= 0),
  pln_power_va integer not null,
  monthly_bill bigint not null,
  usage_pattern varchar(255) not null check (usage_pattern in ('sepi_siang', 'seimbang', 'ramai_siang', 'manual')),
  day_load_kw numeric not null,
  night_load_kw numeric not null,
  params jsonb not null,
  snapshot jsonb not null,
  est_investment bigint not null,
  capacity_kwp numeric not null,
  daily_production_kwh numeric not null,
  daily_saved_kwh numeric not null,
  monthly_saving bigint not null,
  net_profit bigint not null,
  bep_years numeric,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint simulations_jumlah_panel check (panel_qty = panel_series * panel_parallel),
  constraint simulations_baterai check ((battery_part_id is null) = (battery_qty = 0))
);
create index on simulations (user_id);

create table projects (
  id uuid primary key default gen_random_uuid(),
  code varchar(255) not null unique,
  name varchar(255) not null,
  client_id uuid not null references users,
  pic_admin_id uuid references users,
  simulation_id uuid references simulations,
  status_id uuid not null references project_statuses,
  sub_status_id uuid,
  address text not null,
  city varchar(255) not null,
  request_note text,
  rejected_reason text,
  installed_kwp numeric,
  estimated_finish_date date,
  submitted_at timestamptz,
  accepted_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (sub_status_id, status_id) references project_sub_statuses (id, status_id)
);
create trigger projects_updated_at before update on projects for each row execute function set_updated_at();
create index on projects (client_id);
create index on projects (status_id);

create table files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects,
  purpose varchar(255) not null check (purpose in ('invoice_pembelian', 'foto_status', 'tagihan_pdf', 'bukti_bayar', 'bukti_setuju', 'bukti_pengembalian')),
  storage_key varchar(255) not null,
  original_name varchar(255) not null,
  mime_type varchar(255) not null,
  size_bytes integer not null,
  uploaded_by uuid not null references users,
  created_at timestamptz not null default now()
);
create index on files (project_id);

create table status_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects,
  status_id uuid not null references project_statuses,
  sub_status_id uuid,
  note text,
  created_by uuid not null references users,
  created_at timestamptz not null default now(),
  foreign key (sub_status_id, status_id) references project_sub_statuses (id, status_id)
);
create index on status_updates (project_id, created_at);

create table status_update_photos (
  id uuid primary key default gen_random_uuid(),
  status_update_id uuid not null references status_updates,
  file_id uuid not null references files
);
create index on status_update_photos (status_update_id);

create table plannings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects,
  status varchar(255) not null default 'draf' check (status in ('draf', 'final')),
  site_notes text,
  price_valid_until date,
  total_parts bigint not null default 0,
  total_labor bigint not null default 0,
  total_services bigint not null default 0,
  total_accommodation bigint not null default 0,
  grand_total bigint not null default 0,
  finalized_at timestamptz,
  created_by uuid not null references users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plannings_final check (status = 'draf' or (price_valid_until is not null and finalized_at is not null))
);
create trigger plannings_updated_at before update on plannings for each row execute function set_updated_at();

create table planning_items (
  id uuid primary key default gen_random_uuid(),
  planning_id uuid not null references plannings,
  type varchar(255) not null check (type in ('part', 'sdm', 'jasa', 'akomodasi')),
  part_id uuid references parts,
  description varchar(255) not null,
  unit varchar(255),
  qty numeric not null,
  days numeric,
  unit_price bigint not null,
  subtotal bigint not null,
  sort_order integer not null,
  constraint planning_items_part check ((type = 'part') = (part_id is not null)),
  constraint planning_items_days check ((type = 'sdm') = (days is not null))
);
create index on planning_items (planning_id);

-- 17.3 Uang dan pembelian

create table invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects,
  planning_id uuid references plannings,
  type varchar(255) not null check (type in ('awal', 'tambahan')),
  number varchar(255) not null unique,
  status varchar(255) not null check (status in ('draf', 'terbit', 'lunas', 'batal')),
  issued_at timestamptz,
  due_date date,
  price_valid_until date,
  amount_parts bigint not null,
  amount_labor bigint not null,
  amount_services bigint not null,
  amount_accommodation bigint not null,
  total bigint not null,
  pdf_file_id uuid references files,
  notes text,
  created_by uuid not null references users,
  created_at timestamptz not null default now(),
  constraint invoices_terbit check (status = 'draf' or (issued_at is not null and due_date is not null)),
  constraint invoices_awal_planning check (type <> 'awal' or planning_id is not null)
);
create index on invoices (project_id);
-- aturan 18.6: satu tagihan awal yang tidak batal per proyek
create unique index invoices_satu_tagihan_awal on invoices (project_id) where type = 'awal' and status <> 'batal';

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices,
  type varchar(255) not null check (type in ('part', 'sdm', 'jasa', 'akomodasi')),
  description varchar(255) not null,
  unit varchar(255),
  qty numeric not null,
  days numeric,
  unit_price bigint not null,
  subtotal bigint not null,
  sort_order integer not null
);
create index on invoice_items (invoice_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices,
  amount bigint not null,
  paid_at date not null,
  method varchar(255) not null,
  proof_file_id uuid references files,
  note text,
  recorded_by uuid not null references users,
  created_at timestamptz not null default now()
);
create index on payments (invoice_id);

create table purchases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects,
  item_group varchar(255) check (item_group in ('komponen_utama', 'aksesoris')),
  store_name varchar(255),
  purchase_date date,
  invoice_number varchar(255),
  document_type varchar(255) not null check (document_type in ('invoice', 'nota', 'tanpa_nota')),
  file_id uuid references files,
  subtotal_products bigint not null,
  discount bigint not null default 0,
  shipping bigint not null default 0,
  shipping_discount bigint not null default 0,
  other_fees bigint not null default 0,
  total_paid bigint not null,
  status varchar(255) not null default 'draf' check (status in ('draf', 'terkonfirmasi')),
  check_passed boolean,
  extraction_raw jsonb,
  confirmed_by uuid references users,
  confirmed_at timestamptz,
  created_by uuid not null references users,
  created_at timestamptz not null default now(),
  constraint purchases_terkonfirmasi check (status = 'draf'
    or num_nonnulls(item_group, store_name, purchase_date, confirmed_by, confirmed_at) = 5),
  constraint purchases_file check (document_type = 'tanpa_nota' or file_id is not null)
);
create index on purchases (project_id);

create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases,
  part_id uuid references parts,
  name varchar(255) not null,
  unit varchar(255),
  qty numeric not null,
  unit_price bigint not null,
  subtotal bigint not null,
  sort_order integer not null
);
create index on purchase_items (purchase_id);

create table cost_adjustments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects,
  category varchar(255) not null check (category in ('part', 'sdm', 'jasa', 'akomodasi')),
  amount bigint not null,
  reason varchar(255) not null check (reason in ('kesalahan_kami', 'kondisi_lokasi', 'kenaikan_harga', 'lainnya')),
  explanation text not null,
  borne_by varchar(255) not null check (borne_by in ('kami', 'client')),
  client_approved_at date,
  proof_file_id uuid references files,
  invoice_id uuid references invoices,
  created_by uuid not null references users,
  created_at timestamptz not null default now(),
  -- aturan 18.9: tagihan tambahan hanya untuk biaya tanggungan client yang sudah punya bukti setuju
  constraint cost_adjustments_tagihan check (invoice_id is null
    or (borne_by = 'client' and client_approved_at is not null and proof_file_id is not null))
);
create index on cost_adjustments (project_id);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects,
  amount bigint not null,
  refunded_at date not null,
  method varchar(255) not null,
  proof_file_id uuid references files,
  note text,
  recorded_by uuid not null references users,
  created_at timestamptz not null default now()
);
create index on refunds (project_id);
