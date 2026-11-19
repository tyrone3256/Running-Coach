# Running Coach — HM sub-1:45 (30 Mei 2027)

Coach lari personal (PWA, Bahasa Indonesia). Spesifikasi: [docs/SPEC.md](docs/SPEC.md).

## Status milestone

- [x] **M1** schema + RLS + seed + layar *Hari ini* & *Program* (read-only)
- [x] **M2** log manual & log cepat, check-in pagi, import FIT/GPX/TCX (deteksi rep otomatis), antrean offline
- [x] **M3** adaptive engine R1–R13 (deterministik, 1 test file per rule + acceptance), plan versioning dengan diff, approve/tolak, revert
- [x] **M4** coach — sejak M7 berbasis aturan (tanpa AI/biaya): feedback per log, halaman Coach, lapor gejala
- [x] **M5** PWA (install, offline), web push pagi/sore, cron Vercel, konfigurasi deploy, E2E Playwright
- [x] **M6** Strava (opsional, **nonaktif** — input manual dipilih)
- [x] **M8** tab Target (race berikutnya, PB 5K/10K/21K/42K, pace, kendala) → analisis kebugaran & peluang target → ubah target / kalibrasi pace / generator program 5K–FM; login password
- [x] **M7** input manual seperti ringkasan Huawei Health/Strava (zona HR, split per km, elevasi, kalori, Training Effect…), coach berbasis aturan, AI dihapus

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

Data dari Huawei Health: sambungkan Huawei Health ke Strava, lalu di Strava (web) buka aktivitas → ⋯ → *Export Original* / *Export GPX*, upload di **Log → Import file**. Sejak M6 ini otomatis lewat Strava (lihat bagian Strava); import file tetap ada sebagai cadangan.

```bash
npm test             # Vitest: pace/HR, seed, parser, safety, store, engine R1–R13, acceptance, property test guardrail
npm run typecheck
npm run lint
npm run build && npm run test:e2e   # Playwright di build produksi (memakai Edge terpasang; PW_CHANNEL=chrome untuk Chrome)
```

## Adaptive engine (M3)

- Kode: `lib/engine/` (murni, tanpa I/O) — `rules.ts` (R1–R13), `guardrails.ts` (R8/R11), `engine.ts` (dedupe, prioritas, validasi), `snapshot.ts` (apply/diff/inverse), `vdot.ts`.
- Dipicu otomatis setelah simpan log, check-in, dan saat membuka **Hari ini** (sesi terlewat, ACWR).
- **Program → Perubahan program**: riwayat + diff sebelum/sesudah, setujui/tolak perubahan besar, revert.
- **Program → Input hasil tes**: tes 30′ / 10K TT → usulan LTHR + pace (atau LTHR saja).

## Target & program otomatis (M8)

Tab **Target** (menu bawah):
1. Isi **race berikutnya** (nama, kategori 5K/10K/HM/FM, tanggal, target), **performa sekarang** (PB tiap jarak — boleh kosong — dan tanggalnya, pace easy, km/minggu, long run terpanjang, hari lari, hari long run) dan **kendala** (HR 170, panas, cedera, catatan) → **Simpan & analisis**.
2. Analisis: VDOT dari PB terbaik (PB >12 bulan dikoreksi), prediksi 5K–FM, dan penilaian target: *dalam jangkauan / realistis / ambisius / sangat ambisius* (perkiraan ±0,2 VDOT per minggu latihan — kasar, ditampilkan apa adanya) + target cadangan.
3. Aksi (semuanya usulan yang kamu **Setujui**, bisa di-revert):
   - **Ubah target** race aktif — struktur program tetap, hanya sesi pace race yang berubah.
   - **Kalibrasi pace latihan** ke kebugaran (bila beda ≥1 VDOT) — pace race tidak disentuh.
   - **Buat program race ini** — generator (`lib/plan/generate.ts`): transisi pasca race, Base → Build → Spesifik → Peak → Taper, recovery tiap minggu ke-4, maks 2 sesi keras & tidak berurutan (hari kualitas dipilih ≥48 jam dari long run), tangga menit Z4, long run +2 km/minggu sampai batas jarak, volume ≤ +10%/3 minggu, taper sesuai jarak. Disambung setelah race aktif (minggu W28…), program HM tetap utuh.
- Pace latihan dari kebugaran sekarang; sesi pace race memakai kode **RP** (target race baru) — HM Excel tetap memakai **H**.
- Login: **email + password** (atur di ⚙ Pengaturan → Password setelah login pertama lewat link email). Sesi tersimpan sampai Keluar.
- E2E memakai build terpisah tanpa Supabase (`scripts/e2e-server.mjs`, folder `.next-e2e`). Preview lokal tanpa login: konfigurasi `local-preview` (port 3200).

## Coach & input manual (M7)

Tanpa layanan berbayar. Setelah lari, buka **Log → + Log** dan salin dari layar ringkasan aktivitas di Huawei Health (atau Strava):

| Di app | Huawei Health | Strava |
|---|---|---|
| Jarak, Waktu bergerak | Jarak, Durasi | Distance, Moving Time |
| Waktu total | — | Elapsed Time |
| HR rata-rata / maks | Detak jantung rata-rata / maks | Avg / Max Heart Rate |
| Kadens (langkah/menit) | Kadens rata-rata | Cadence (angka <120 otomatis ×2) |
| Panjang langkah, Total langkah | Panjang langkah rata-rata, Langkah | — |
| Elevasi naik, Kalori | Total kenaikan, Kalori | Elevation Gain, Calories |
| Training load, Aerobic/Anaerobic TE, Waktu pemulihan | Efek latihan | — |
| Waktu di zona HR (menit) | Zona detak jantung | Heart Rate zones |
| Split per km (pace + HR) | Tab Pace | Splits |
| Interval / rep | Lap / interval | Laps |
| RPE 1–10 | — | Perceived Exertion |

Wajib: jarak, waktu, RPE. Sisanya opsional; makin lengkap makin tajam feedback-nya. Zona HR: samakan dulu batas zona di jam/aplikasi dengan tabel di ⚙ Pengaturan → Zona HR.

- **Feedback coach** muncul di detail log, dihitung dari aturan program (`lib/coach/feedback.ts`): eksekusi vs rencana (pace & zona), toleransi Z4, rep, cue HR 170 (maks 3), pacing & cardiac drift dari split, kadens, Training Effect, perubahan program yang dipicu log, sesi berikutnya. Log red flag hanya mendapat STOP.
- **Tab Coach**: sesi hari ini/berikutnya + tujuan + cue, feedback lari terakhir, tabel toleransi Z4, ringkasan minggu, panduan "HR 170 berat: normal atau bahaya", aturan sesi terlewat, dan **Lapor gejala bahaya** (program langsung ditahan sampai kamu menyatakan sudah diperiksa dokter).
- Import file FIT/GPX/TCX tetap ada (mis. GPX dari Strava web → ⋯ → Export GPX); split per km dihitung otomatis dari file.

## Regenerasi seed dari Excel

```bash
python scripts/parse_plan.py   # butuh openpyxl → seed/plan.json + seed/parse_report.md
```

## PWA & notifikasi (M5)

- Service worker (`public/sw.js`, aktif di build produksi): aset di-cache, halaman yang pernah dibuka bisa dilihat offline, halaman lain → `/offline`. Log & check-in offline tetap lewat antrean IndexedDB (M2). Logout menghapus cache halaman & riwayat chat.
- **Hari ini → ⚙ Pengaturan**: pasang app, aktifkan/matikan notifikasi, kirim tes.
- Cron (`vercel.json`): `05:00 WIB` engine harian + notifikasi sesi hari ini/check-in (hari tanpa lari hanya bila ada perubahan menunggu persetujuan); `19:00 WIB` pengingat log bila sesi hari ini belum dicatat. Saat hold red flag: hanya pengingat ke dokter.
- Cron berjalan tanpa sesi login: route `/api/cron/*` hanya menerima `Authorization: Bearer $CRON_SECRET`, lalu memakai service-role key **terbatas pada akun `OWNER_EMAIL`**.

## Strava (M6, opsional — nonaktif)

Kode tetap ada tapi tidak dipakai: tanpa env `STRAVA_*` semua menu Strava tersembunyi. Untuk mengaktifkan nanti:

Alur: jam Huawei → Huawei Health → (sinkron ke Strava, atur di Huawei Health → Saya → Berbagi data) → Strava → app ini.

- Setiap lari baru masuk sebagai **draft** (jarak, durasi, HR, cadence, rep terdeteksi, sesi program dicocokkan dari tanggal). Draft **tidak** otomatis jadi log: RPE, rasa, nyeri, dan red flag hanya kamu yang tahu. Notifikasi "Lari baru dari Strava" → buka → isi RPE → **Simpan log** → engine berjalan.
- Bukan lari (Ride/Walk) dilewati. Aktivitas yang sudah kamu import manual (tanggal sama, jarak & durasi ±3%) tidak dobel. Draft bisa diabaikan.
- Masuk lewat webhook (hampir seketika). Cadangan: cron 05:00/19:00 menarik 2 hari terakhir; tombol **Sinkron 14 hari** di ⚙ Pengaturan.
- Token Strava hanya disimpan di server (tabel `strava_connections`, RLS); refresh token otomatis. **Putuskan** mencabut akses di Strava (`/oauth/revoke`).

Setup (sekali):
1. https://www.strava.com/settings/api → buat app. *Authorization Callback Domain* = domain Vercel (lokal: `localhost`).
2. Vercel env: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN` (string acak). Redeploy.
3. Daftarkan webhook (app harus sudah live karena Strava langsung memvalidasi):
   ```bash
   npx tsx --env-file=.env.local scripts/strava-webhook.ts create https://<domain>/api/strava/webhook
   ```
   Isi `STRAVA_SUBSCRIPTION_ID` di Vercel dengan id yang dicetak, redeploy. (`view` / `delete <id>` untuk mengelola.)
4. ⚙ Pengaturan → **Connect with Strava** → centang izin melihat aktivitas (termasuk "Only you").

App Strava baru berstatus *Single Player Mode* (1 atlet) — cukup untuk app ini. Batas API: 100 request/15 menit, 1.000/hari (satu lari ≈ 2–3 request).

## Deploy ke Vercel

1. **Supabase** (lihat bagian bawah): jalankan semua migrasi, lalu `npm run seed:supabase` sekali dari laptop.
2. **VAPID key** untuk push (sekali):
   ```bash
   node -e "import('web-push').then(w=>console.log(w.generateVAPIDKeys()))"
   ```
3. **Vercel**: import repo → Framework Next.js. Environment Variables (Production):
   | Variabel | Isi |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | dari Supabase → Project Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | service role (server only; hanya dipakai cron) |
   | `OWNER_EMAIL` | email login kamu |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | dari langkah 2 |
   | `VAPID_SUBJECT` | `mailto:` email kamu |
   | `CRON_SECRET` | string acak panjang (`openssl rand -hex 32`) — Vercel mengirimnya otomatis ke cron |
4. Supabase → Auth → URL Configuration: Site URL = domain Vercel, tambahkan `https://<domain>/auth/callback` ke Redirect URLs.
5. Deploy, buka di Chrome Android → login magic link → ⋮ **Instal aplikasi** → ⚙ Pengaturan → **Aktifkan notifikasi** → **Kirim tes**.

Region fungsi `sin1` (Singapura, terdekat ke Jakarta). Paket Hobby cukup: 2 cron harian.

## Supabase

1. Buat project di supabase.com, jalankan semua file di `supabase/migrations/` (urut nama) di SQL Editor.
2. Auth → Email: aktifkan magic link; Auth → URL Configuration: tambahkan `http://localhost:3000/auth/callback`.
3. Isi `.env.local` dari `.env.example`, lalu:
   ```bash
   npm run seed:supabase
   ```
   (Memasukkan `OWNER_EMAIL` ke allowlist, membuat user, profil, pace/HR profile v1, plan v1, 27 minggu, 135 sesi.)
4. `npm run dev` → app minta login magic link; hanya email di allowlist yang bisa masuk; RLS membatasi semua tabel ke `auth.uid()`.
