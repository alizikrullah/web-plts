-- Verifikasi email saat daftar dan lupa password lewat email (permintaan tim 24 Nov 2026, PRD bagian 4).
-- Akun yang sudah ada dianggap terverifikasi; akun baru yang daftar sendiri mulai dari belum terverifikasi.
alter table users add column is_verified boolean not null default true;
alter table users alter column is_verified set default false;

-- Token sekali pakai untuk link di email. Yang disimpan hanya hash-nya, seperti refresh_tokens.
create table email_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users,
  purpose varchar(255) not null check (purpose in ('verifikasi', 'reset_password')),
  token_hash varchar(255) not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_tokens_user on email_tokens (user_id, purpose, created_at);
