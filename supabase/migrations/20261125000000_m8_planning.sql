-- M8: tab Target (profil perencanaan) + rangkaian race/program.
alter table public.athlete_profile add column if not exists planning jsonb;
-- program berikutnya melanjutkan nomor minggu (HM W01–W27, race berikutnya W28…)
alter table public.plan_weeks drop constraint if exists plan_weeks_week_check;
alter table public.plan_weeks add constraint plan_weeks_week_check check (week between 1 and 520);
