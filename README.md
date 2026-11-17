# Running Coach — HM sub-1:45 (30 Mei 2027)

Coach lari personal (PWA, Bahasa Indonesia). Spesifikasi: [docs/SPEC.md](docs/SPEC.md).

## Status milestone

- [x] **M1** schema + RLS + seed + layar *Hari ini* & *Program* (read-only)
- [x] **M2** log manual & log cepat, check-in pagi, import FIT/GPX/TCX (deteksi rep otomatis), antrean offline
- [x] **M3** adaptive engine R1–R13 (deterministik, 1 test file per rule + acceptance), plan versioning dengan diff, approve/tolak, revert
- [ ] M4 AI coach + tools
- [ ] M5 PWA install + push + deploy
- [ ] M6 Strava (jalur utama data Huawei Health → Strava)

## Jalankan lokal

Butuh Node ≥ 20.

```bash
npm install
npm run dev          # http://localhost:3000
```

Tanpa `.env.local`, app memakai `seed/plan.json` langsung (tanpa login) dan menyimpan log/check-in ke `.local-data/db.json` (diabaikan git; diblok di produksi). Pratinjau tanggal lain: `/?date=2027-02-11`.

Contoh file FIT untuk mencoba import (tempo W12, rep 3 berhenti di menit ke-6):

```bash
npx tsx scripts/make-sample-fit.ts sample-tempo.fit
```

Data dari Huawei Health: sambungkan Huawei Health ke Strava, lalu di Strava (web) buka aktivitas → ⋯ → *Export Original* / *Export GPX*, upload di **Log → Import file**. (Otomatis lewat Strava API di M6.)

```bash
npm test             # Vitest: pace/HR, seed, parser, safety, store, engine R1–R13, acceptance, property test guardrail
npm run typecheck
npm run lint
```

## Adaptive engine (M3)

- Kode: `lib/engine/` (murni, tanpa I/O) — `rules.ts` (R1–R13), `guardrails.ts` (R8/R11), `engine.ts` (dedupe, prioritas, validasi), `snapshot.ts` (apply/diff/inverse), `vdot.ts`.
- Dipicu otomatis setelah simpan log, check-in, dan saat membuka **Hari ini** (sesi terlewat, ACWR).
- **Program → Perubahan program**: riwayat + diff sebelum/sesudah, setujui/tolak perubahan besar, revert.
- **Program → Input hasil tes**: tes 30′ / 10K TT → usulan LTHR + pace (atau LTHR saja).

## Regenerasi seed dari Excel

```bash
python scripts/parse_plan.py   # butuh openpyxl → seed/plan.json + seed/parse_report.md
```

## Supabase (opsional di M1)

1. Buat project di supabase.com, jalankan semua file di `supabase/migrations/` (urut nama) di SQL Editor.
2. Auth → Email: aktifkan magic link; Auth → URL Configuration: tambahkan `http://localhost:3000/auth/callback`.
3. Isi `.env.local` dari `.env.example`, lalu:
   ```bash
   npm run seed:supabase
   ```
   (Memasukkan `OWNER_EMAIL` ke allowlist, membuat user, profil, pace/HR profile v1, plan v1, 27 minggu, 135 sesi.)
4. `npm run dev` → app minta login magic link; hanya email di allowlist yang bisa masuk; RLS membatasi semua tabel ke `auth.uid()`.
