# Running Coach — HM sub-1:45 (30 Mei 2027)

Coach lari personal (PWA, Bahasa Indonesia). Spesifikasi: [docs/SPEC.md](docs/SPEC.md).

## Status milestone

- [x] **M1** schema + RLS + seed + layar *Hari ini* & *Program* (read-only)
- [x] **M2** log manual & log cepat, check-in pagi, import FIT/GPX/TCX (deteksi rep otomatis), antrean offline
- [x] **M3** adaptive engine R1–R13 (deterministik, 1 test file per rule + acceptance), plan versioning dengan diff, approve/tolak, revert
- [x] **M4** AI coach (Claude, server-only) dengan 11 tool di atas engine, safety pre-filter, feedback otomatis per log
- [x] **M5** PWA (install, offline), web push pagi/sore, cron Vercel, konfigurasi deploy, E2E Playwright
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
npm run build && npm run test:e2e   # Playwright di build produksi (memakai Edge terpasang; PW_CHANNEL=chrome untuk Chrome)
```

## Adaptive engine (M3)

- Kode: `lib/engine/` (murni, tanpa I/O) — `rules.ts` (R1–R13), `guardrails.ts` (R8/R11), `engine.ts` (dedupe, prioritas, validasi), `snapshot.ts` (apply/diff/inverse), `vdot.ts`.
- Dipicu otomatis setelah simpan log, check-in, dan saat membuka **Hari ini** (sesi terlewat, ACWR).
- **Program → Perubahan program**: riwayat + diff sebelum/sesudah, setujui/tolak perubahan besar, revert.
- **Program → Input hasil tes**: tes 30′ / 10K TT → usulan LTHR + pace (atau LTHR saja).

## AI coach (M4)

Isi di `.env.local` (server only — tidak pernah berprefix `NEXT_PUBLIC_`):

```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5-5   # opsional; default claude-opus-5-5
```

- Kode: `lib/coach/` — `agent.ts` (loop tool use), `tools.ts` (11 tool, input divalidasi zod), `actions.ts` (aksi perubahan yang boleh diusulkan coach → dibangun dengan builder engine), `prompt.ts` (persona + cue HR 170), `server.ts` (klien Anthropic; hanya di server).
- **Coach** (tab bawah): chat; riwayat disimpan di HP (localStorage), 20 giliran terakhir dikirim ke server.
- **Log → detail**: feedback coach dibuat otomatis sekali saat log dibuka, lalu disimpan di log.
- Red flag di chat (mis. "nyeri dada", "dada terasa sesak") dijawab STOP **tanpa** memanggil LLM dan menahan program sampai kamu menekan "sudah diperiksa dokter". Ini jalan walau API key kosong.
- Coach hanya bisa mengubah plan lewat `propose_plan_change` (aksi terbatas: easy, kurangi volume, pecah rep, rest, pindah, geser pace) → guardrail engine. Usulan kecil diterapkan coach setelah kamu setuju di chat; usulan besar hanya lewat tombol **Setujui**.
- Tanpa API key: semua fitur lain jalan; layar Coach menampilkan "belum aktif".

## Regenerasi seed dari Excel

```bash
python scripts/parse_plan.py   # butuh openpyxl → seed/plan.json + seed/parse_report.md
```

## PWA & notifikasi (M5)

- Service worker (`public/sw.js`, aktif di build produksi): aset di-cache, halaman yang pernah dibuka bisa dilihat offline, halaman lain → `/offline`. Log & check-in offline tetap lewat antrean IndexedDB (M2). Logout menghapus cache halaman & riwayat chat.
- **Hari ini → ⚙ Pengaturan**: pasang app, aktifkan/matikan notifikasi, kirim tes.
- Cron (`vercel.json`): `05:00 WIB` engine harian + notifikasi sesi hari ini/check-in (hari tanpa lari hanya bila ada perubahan menunggu persetujuan); `19:00 WIB` pengingat log bila sesi hari ini belum dicatat. Saat hold red flag: hanya pengingat ke dokter.
- Cron berjalan tanpa sesi login: route `/api/cron/*` hanya menerima `Authorization: Bearer $CRON_SECRET`, lalu memakai service-role key **terbatas pada akun `OWNER_EMAIL`**.

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
   | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | coach AI (model opsional) |
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
