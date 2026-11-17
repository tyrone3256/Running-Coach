-- M6: Strava (jalur Huawei Health → Strava → app). Token hanya dibaca server; RLS per user.

create table if not exists public.strava_connections (
  user_id uuid primary key references auth.users on delete cascade,
  athlete_id bigint not null unique,
  athlete_name text,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null,
  scope text not null,
  last_sync_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.strava_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  activity_id bigint not null,
  name text not null,
  start_date timestamptz not null,
  draft jsonb not null,
  status text not null default 'pending' check (status in ('pending','dismissed')),
  created_at timestamptz not null default now(),
  unique (user_id, activity_id)
);

do $$
declare t text;
begin
  foreach t in array array['strava_connections','strava_inbox'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy owner_all on public.%I for all to authenticated
                     using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t);
  end loop;
end $$;
