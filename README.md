# Running Coach — HM sub-1:45 (30 Mei 2027)

Coach lari personal (PWA, Bahasa Indonesia). Spesifikasi: [docs/SPEC.md](docs/SPEC.md).

## Status milestone

- [x] **M1** schema + RLS + seed + layar *Hari ini* & *Program* (read-only)
- [ ] M2 logging + check-in + import FIT/GPX/TCX
- [ ] M3 rules engine R1–R13 + plan versioning
- [ ] M4 AI coach + tools
- [ ] M5 PWA install + push + deploy
- [ ] M6 Strava (jalur utama data Huawei Health → Strava)

## Jalankan lokal

Butuh Node ≥ 20.

```bash
npm install
npm run dev          # http://localhost:3000
```

Tanpa `.env.local`, app memakai `seed/plan.json` langsung (tanpa login). Pratinjau tanggal lain: `/?date=2027-02-11`.

```bash
npm test             # Vitest: pace/HR resolver, integritas seed, seed rows
npm run typecheck
npm run lint
```

## Regenerasi seed dari Excel

```bash
python scripts/parse_plan.py   # butuh openpyxl → seed/plan.json + seed/parse_report.md
```

## Supabase (opsional di M1)

1. Buat project di supabase.com, jalankan `supabase/migrations/20261117000000_init.sql` di SQL Editor.
2. Auth → Email: aktifkan magic link; Auth → URL Configuration: tambahkan `http://localhost:3000/auth/callback`.
3. Isi `.env.local` dari `.env.example`, lalu:
   ```bash
   npm run seed:supabase
   ```
   (Memasukkan `OWNER_EMAIL` ke allowlist, membuat user, profil, pace/HR profile v1, plan v1, 27 minggu, 135 sesi.)
4. `npm run dev` → app minta login magic link; hanya email di allowlist yang bisa masuk; RLS membatasi semua tabel ke `auth.uid()`.
