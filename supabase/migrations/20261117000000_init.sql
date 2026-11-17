-- Running Coach — schema awal (M1)
-- Single-user, tapi semua tabel tetap ber-user_id + RLS (akses hanya pemilik).

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ allowlist
-- Hanya email di tabel ini yang boleh memakai app (dicek di app + trigger signup).
create table public.allowed_emails (
  email text primary key
);
alter table public.allowed_emails enable row level security; -- tanpa policy = tidak terbaca client

create or replace function public.enforce_allowlist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.allowed_emails a where lower(a.email) = lower(new.email)) then
    raise exception 'Email tidak diizinkan';
  end if;
  return new;
end $$;

create trigger enforce_allowlist before insert on auth.users
  for each row execute function public.enforce_allowlist();

-- ------------------------------------------------------------------ profil
create table public.athlete_profile (
  user_id uuid primary key references auth.users on delete cascade,
  name text not null,
  base text,
  race_name text,
  race_date date not null,
  race_distance_m numeric not null default 21097.5,
  goal_time_s int not null,
  goal_pace_s int not null,
  run_days text[] not null default '{tue,wed,thu,sat,sun}',
  gym_template jsonb not null default '{}',
  hr_source_default text not null default 'wrist' check (hr_source_default in ('chest','wrist')),
  watch_model text,
  data_source text,            -- mis. 'huawei_health_via_strava'
  timezone text not null default 'Asia/Jakarta',
  updated_at timestamptz not null default now()
);

create table public.pace_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  version int not null,
  valid_from date not null,
  codes jsonb not null,                 -- {"E":[350,390], ...} detik/km [cepat, lambat]
  base_phase jsonb not null default '{}', -- {"weeks":[3,8],"T":[298,305],"N":[275,285]}
  source text not null check (source in ('seed','rule','test','manual')),
  plan_change_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, version)
);

create table public.hr_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  version int not null,
  valid_from date not null,
  lthr int not null check (lthr between 120 and 220),
  source text not null check (source in ('estimate','test')),
  test_log_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, version)
);

-- ------------------------------------------------------------------ plan
create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  version int not null,
  parent_version int,
  reason text not null,
  is_active boolean not null default false,
  meta jsonb not null default '{}',     -- keputusan parsing, sumber, z4 ladder, dll.
  created_at timestamptz not null default now(),
  unique (user_id, version)
);
create unique index plan_versions_one_active on public.plan_versions (user_id) where is_active;

create table public.plan_weeks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  plan_version_id uuid not null references public.plan_versions on delete cascade,
  week int not null check (week between 1 and 60),
  start_date date not null,
  phase text not null,
  is_recovery_week boolean not null default false,
  is_taper boolean not null default false,
  planned_km numeric not null,
  color jsonb not null default '{}',
  guardrail_exception jsonb,
  unique (plan_version_id, week)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  plan_version_id uuid not null references public.plan_versions on delete cascade,
  key text not null,                    -- 'W05-thu' (stabil antar versi)
  date date not null,
  week int not null,
  day text not null check (day in ('mon','tue','wed','thu','fri','sat','sun')),
  phase text not null,
  type text not null,
  segments jsonb not null,              -- Segment[] berkode intensitas, TANPA pace absolut
  planned_km numeric not null,
  is_hard boolean not null default false,
  z4_target_min numeric,
  z4_planned_min numeric,
  notes text[] not null default '{}',
  source_text text,
  status text not null default 'planned' check (status in ('planned','done','skipped','moved','rest')),
  moved_from date,
  unique (plan_version_id, key)
);
create index sessions_user_date on public.sessions (user_id, date);

create table public.plan_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  from_version int not null,
  to_version int not null,
  rule_id text not null,                -- 'R1'..'R13' | 'manual' | 'coach'
  size text not null check (size in ('small','large')),
  diff jsonb not null,
  reason text not null,
  mode text not null check (mode in ('auto','approved','rejected','pending')),
  reverted_by uuid references public.plan_changes,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ log & check-in
create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  session_key text,                     -- 'W05-thu'; null = lari di luar program
  distance_m numeric,
  duration_s int,
  avg_pace_s int,
  avg_hr int,
  max_hr int,
  hr_source text check (hr_source in ('chest','wrist')),
  avg_cadence int,
  rpe int check (rpe between 1 and 10),
  reps jsonb,                           -- [{pace_s, avg_hr, completed, stop_reason, stop_at_s}]
  time_in_zone jsonb,                   -- {"Z1": s, ...}
  hr_drop_1min int,
  discomfort_at_hr jsonb,               -- {"flag": true, "bpm": 171}
  temp_c numeric,
  humidity numeric,
  pain jsonb,                           -- {"score": 0-10, "location": "...", "sharp": bool}
  red_flags text[] not null default '{}',
  sensor_suspect boolean not null default false,
  sensor_suspect_reason text,
  notes text,
  source text not null default 'manual' check (source in ('manual','fit','gpx','tcx','strava')),
  external_id text,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);
create index workout_logs_user_date on public.workout_logs (user_id, date);

create table public.daily_checkins (
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  resting_hr int,
  sleep_h numeric,
  soreness int check (soreness between 1 and 10),
  pain_score int check (pain_score between 0 and 10),
  pain_location text,
  hrv numeric,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

create table public.strength_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  type text not null,
  exercises jsonb not null default '[]',
  notes text
);

create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  thread text not null default 'main',
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null,
  tool_calls jsonb,
  kind text,                            -- 'chat' | 'log_feedback' | 'weekly' | 'morning_brief'
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array[
    'athlete_profile','pace_profile','hr_profile','plan_versions','plan_weeks','sessions',
    'plan_changes','workout_logs','daily_checkins','strength_logs','coach_messages'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy owner_all on public.%I for all to authenticated
                     using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t);
  end loop;
end $$;
