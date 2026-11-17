-- M2: kolom tambahan log
alter table public.workout_logs
  add column if not exists rep_incomplete boolean not null default false,
  add column if not exists streams jsonb,           -- {t[],hr[],d[],cad[]} ±5 dtk
  add column if not exists safety jsonb not null default '{"level":"ok","reasons":[]}';

create index if not exists daily_checkins_user_date on public.daily_checkins (user_id, date);
