-- Kolom ringkasan seperti di Huawei Health / Strava (input manual). Semua opsional.
alter table public.workout_logs
  add column if not exists elapsed_s int,
  add column if not exists elevation_gain_m numeric,
  add column if not exists calories_kcal int,
  add column if not exists avg_stride_cm numeric,
  add column if not exists total_steps int,
  add column if not exists training_load numeric,
  add column if not exists aerobic_te numeric check (aerobic_te between 0 and 5),
  add column if not exists anaerobic_te numeric check (anaerobic_te between 0 and 5),
  add column if not exists recovery_h numeric,
  add column if not exists splits jsonb not null default '[]';
