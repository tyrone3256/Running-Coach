-- M3: adaptive engine — perubahan plan, notice, clearance medis, cuaca check-in

alter table public.plan_changes
  alter column from_version drop not null,
  alter column to_version drop not null,
  add column if not exists key text,
  add column if not exists title text,
  add column if not exists changes jsonb not null default '[]',
  add column if not exists inverse jsonb,
  add column if not exists evidence jsonb,
  add column if not exists alternatives jsonb,
  add column if not exists cues jsonb,
  add column if not exists blocked_by jsonb,
  add column if not exists reverts uuid references public.plan_changes,
  add column if not exists date date not null default current_date;

alter table public.plan_changes drop constraint if exists plan_changes_mode_check;
alter table public.plan_changes add constraint plan_changes_mode_check
  check (mode in ('auto','approved','rejected','pending','blocked'));
alter table public.plan_changes drop constraint if exists plan_changes_rule_id_check;
create unique index if not exists plan_changes_user_key on public.plan_changes (user_id, key);

create table if not exists public.engine_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  key text not null,
  rule text not null,
  level text not null check (level in ('info','warn','stop')),
  message text not null,
  log_id uuid,
  date date not null,
  cues jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

create table if not exists public.medical_clearances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  cleared_at timestamptz not null,
  note text
);

alter table public.daily_checkins
  add column if not exists temp_c numeric,
  add column if not exists humidity numeric;

do $$
declare t text;
begin
  foreach t in array array['engine_notices','medical_clearances'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy owner_all on public.%I for all to authenticated
                     using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t);
  end loop;
end $$;
