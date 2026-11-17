-- M4: AI coach — feedback per log, red flag dari chat (ikut memicu hold)

alter table public.workout_logs
  add column if not exists coach_feedback text,
  add column if not exists coach_feedback_at timestamptz;

create table if not exists public.safety_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  date date not null,
  reasons jsonb not null default '[]',
  source text not null check (source in ('chat'))
);

alter table public.safety_events enable row level security;
alter table public.safety_events force row level security;
create policy owner_all on public.safety_events for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
