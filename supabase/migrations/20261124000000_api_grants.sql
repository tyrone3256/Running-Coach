-- Hak akses API eksplisit. Project Supabase baru tidak lagi otomatis memberi hak ke role API
-- untuk tabel yang dibuat lewat SQL. Keamanan baris tetap oleh RLS (owner_all per user).
--   service_role : server (seed, cron) — melewati RLS
--   authenticated: user login — dibatasi RLS ke barisnya sendiri
--   anon         : tidak diberi akses tabel sama sekali

grant usage on schema public to authenticated, service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- allowlist hanya untuk server (trigger memakai security definer)
revoke all on public.allowed_emails from authenticated, anon;

-- tabel yang dibuat nanti ikut aturan yang sama
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
