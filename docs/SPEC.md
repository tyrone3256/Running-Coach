# SPEC — Personal Running Coach (HM sub-1:45, 30 Mei 2027)

Status: **Disetujui 2026-11-17** (stack default PWA Next.js + Supabase). M1 selesai.
Sumber program: `data/Program_HM_Sub145_Mei2027.xlsx` → `seed/plan.json` (via `scripts/parse_plan.py`, laporan: `seed/parse_report.md`).

---

## 1. Ringkasan

Aplikasi coach lari untuk **satu pengguna** (Tyrone), installable di HP (PWA), UI & coach berbahasa Indonesia.
Inti sistem:

1. **Plan terstruktur**: setiap segmen sesi menyimpan *kode intensitas* (`E`, `T`, `N`, …), bukan pace absolut. Pace & bpm dihitung saat tampil dari **pace profile** + **LTHR** yang aktif → ubah profil = semua sesi mendatang ikut berubah.
2. **Adaptive engine deterministik** (R1–R13): fungsi murni `(state, event) → proposals[]`, setiap usulan divalidasi guardrail (R8, R11) dan disimpan sebagai `plan_version` baru dengan diff + alasan + bisa di-revert.
3. **AI coach** (Claude, server-side saja) yang hanya *membaca* data dan *mengusulkan* perubahan lewat tools; tidak pernah menulis plan langsung.

## 2. Stack (usulan default — perlu konfirmasi)

| Lapisan | Pilihan | Catatan |
|---|---|---|
| App | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui | PWA: manifest + service worker (Serwist) |
| Offline | Cache sesi hari ini + IndexedDB antrean log (sync saat online) | |
| DB/Auth | Supabase Postgres + Auth magic link, RLS `user_id = auth.uid()` | Signup dimatikan; hanya 1 email di allowlist |
| AI | `@anthropic-ai/sdk` di Route Handler (runtime Node) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` di env server; tidak ada `NEXT_PUBLIC_` |
| File import | `fit-file-parser` (FIT), parser XML sendiri (GPX/TCX) | parsing di server |
| Chart | Recharts | |
| Push | Web Push (VAPID) + Vercel Cron | iPhone: push hanya bila PWA di-*Add to Home Screen* (iOS ≥16.4) |
| Test | Vitest (engine, parser, pace calc) + Playwright (smoke) | |
| Deploy | Vercel + Supabase cloud | |

Alternatif: **Expo (React Native)** — lebih "native" (notifikasi andal di iOS, akses HealthKit/Health Connect), tapi rilis lewat store/TestFlight lebih repot. Untuk 1 pengguna, PWA lebih cepat; rules engine ditulis sebagai paket TS murni (`packages/engine`) sehingga bisa dipakai ulang bila pindah ke Expo.

## 3. Arsitektur

```
app/ (Next.js)
  (ui)  today/ program/ log/ insights/ coach/ race/ settings/
  api/  coach/route.ts        ← satu-satunya tempat memanggil Claude
        logs/route.ts, import/route.ts, checkin/route.ts
        plan/propose|apply|revert/route.ts
        cron/morning-brief|weekly-review/route.ts
lib/
  engine/   ← TS murni, tanpa I/O, 100% unit-test
    pace.ts        resolvePace(segment, paceProfile, phase) / resolveHr(zone, lthr)
    rules/r01..r13.ts
    guardrails.ts  (R8, R11, hard-day checks)
    diff.ts        planDiff(a,b), applyChanges(plan, changes)
    vdot.ts        Daniels–Gilbert
  coach/    tools.ts (schema tool + handler → engine/DB), prompt.ts, safety.ts (red-flag detector)
  import/   fit.ts gpx.ts tcx.ts → WorkoutLog
  db/       supabase client (server & browser, anon key saja di browser)
supabase/migrations/*.sql   seed/plan.json → seed script
```

Alur perubahan plan:
```
log/checkin/test  →  engine.evaluate(state)  →  proposals[] (rule_id, changes, reason, size: small|large)
   → guardrails.validate(plan + changes)   (tolak / pangkas bila melanggar R8/R11)
   → small: apply otomatis + notifikasi      large: status "pending", tunggu persetujuan
   → plan_versions (n+1) + plan_changes(diff, rule_id, reason, auto|approved, reverted_at)
```

## 4. Data model (Postgres)

Semua tabel punya `user_id uuid references auth.users` + RLS `using (user_id = auth.uid())`.

| Tabel | Kolom utama |
|---|---|
| `athlete_profile` | name, base, race_date, goal_time_s, goal_pace_s, run_days, gym_template jsonb, hr_source_default (chest/wrist), watch_model |
| `pace_profile` | version, valid_from, codes jsonb `{E:[350,390],…}`, base_phase_overrides jsonb, source (seed/rule/test/manual), plan_change_id |
| `hr_profile` | version, valid_from, lthr, source (`estimate`/`test`), test_log_id |
| `plan_versions` | version, created_at, parent_version, reason, is_active |
| `sessions` | plan_version, date, week, phase, day, type, segments jsonb, planned_km, is_hard, z4_target_min, status (planned/done/skipped/moved), moved_from |
| `workout_logs` | date, session_id, distance_m, duration_s, avg_pace_s, avg_hr, max_hr, hr_source, avg_cadence, rpe, reps jsonb `[{pace_s,avg_hr,completed,stop_reason}]`, time_in_zone jsonb, hr_drop_1min, discomfort_at_hr `{flag,bpm}`, temp_c, humidity, pain `{score,location,sharp}`, red_flags text[], notes, source (manual/fit/gpx/tcx/strava), sensor_suspect bool + reason |
| `daily_checkins` | date, resting_hr, sleep_h, soreness 1–10, pain 0–10 + location, hrv? |
| `strength_logs` | date, type, exercises jsonb (opsional) |
| `plan_changes` | plan_version_from/to, rule_id, size, diff jsonb, reason, mode (auto/approved/rejected/pending), reverted_by |
| `coach_messages` | thread, role, content, tool_calls jsonb, created_at |

### Segment (JSON di `sessions.segments`)
```ts
type Segment = {
  kind: 'warmup'|'work'|'recovery'|'steady'|'cooldown'|'strides'|'hill'|'test'
  reps?: number; distance_m?: number|null; duration_s?: number
  intensity: 'WU'|'E'|'REC'|'L'|'M'|'H'|'T'|'N'|'JOG'|'TJOG'|'S'|'HILL'|'TEST'
  pace_variant?: 'base'            // paksa varian fase Base (T/N)
  pace_adj_s?: [number, number]    // offset relatif dari kode (lihat §8 keputusan)
  hr_zone: 'Z1'|'Z1-2'|'Z2'|'Z2-3'|'Z3'|'Z3-4'|'Z4'|'Z4-5'|'Z5'|null
  z4_target_min?: number; label?: string; note?: string
  between_reps?: boolean; fill_remaining?: boolean; src_pace?: string  // jejak teks Excel
}
```
Pace tampil = `profile[code] (varian fase) + pace_adj_s + penyesuaian panas (R9, hanya tampilan hari itu)`.
bpm tampil = `round(LTHR × %zona)`: Z1 <85, Z2 85–89, Z3 90–94, Z4 95–100, Z5 101–106.

## 5. Fitur per layar

1. **Hari ini** — kartu sesi (segmen + pace + bpm + target menit Z4), banner readiness (R6), check-in pagi (≤4 input), quick-log ≤30 dtk: jarak, durasi, avg HR, RPE slider, toggle "HR 170 terasa berat" (+bpm), "rep tidak selesai" (+rep ke-, menit ke-), nyeri (skor+lokasi), red-flag checklist.
2. **Program** — grid 27 minggu warna fase seperti Excel (Transisi abu, Base hijau, Build biru, Spesifik oranye, Peak merah, Taper ungu), badge minggu pemulihan & sesi keras, km rencana vs aktual, detail sesi + riwayat perubahan.
3. **Log** — form manual + upload FIT/GPX/TCX (HR, cadence, splits/laps → reps otomatis, time-in-zone). Fase 2: Strava OAuth + webhook.
4. **Insights** — km mingguan rencana vs aktual; pace easy pada HR Z2; HR pada pace 4:55–5:00; kurva toleransi Z4 (menit Z4 per sesi vs tangga); HR drop 1 menit; ACWR 7/28; distribusi zona; prediksi HM (VDOT).
5. **Coach** — chat + feedback otomatis per log, ringkasan Minggu malam, brief pagi (dengan cue HR 170 di hari kualitas).
6. **Race plan** — split per 5 km (25:05 / 24:45 / 24:40 / 24:30 / 5:25) + batas HR: km 1–5 ≤95% LTHR, km 6–15 ≤LTHR, km 16+ boleh naik.
7. **Settings** — LTHR, pace profile (versi), target race, hr_source default, export CSV/XLSX, backup JSON.
8. **Notifikasi** — push pengingat sesi pagi (jam bisa diatur) & review mingguan.

## 6. Adaptive engine — daftar rules + contoh

Konvensi: "easy run" = sesi `easy|easy_strides|easy_hill|recovery|long` (bagian Z2). Data HR dari log yang `sensor_suspect=true` (R13) **diabaikan** untuk R1–R4 & R12. Ukuran perubahan: **kecil** (≤10 dtk/km atau ≤20% volume 1 sesi, termasuk pemecahan rep R12) → otomatis + notifikasi; **besar** (zona >10 dtk/km kumulatif, susunan minggu, target, LTHR) → perlu persetujuan.

| ID | Pemicu | Aksi | Contoh |
|---|---|---|---|
| R1 | ≥2 dari 3 easy/long terakhir: avg HR > batas atas Z2 (+5 bpm bila suhu ≥30°C) **atau** RPE ≥5 | E/L/REC +10 dtk/km (maks +30 per 14 hari) | LTHR 170 → Z2 atas 151. 3 easy ＠6:00 HR 160 → E 5:50–6:30 jadi 6:00–6:40 (kecil, otomatis) |
| R2 | ≥4 dari 5 easy: avg HR <85% LTHR (<145) **dan** RPE ≤3 | E/L −5 dtk/km | |
| R3 | Sesi kualitas gagal: rep rata-rata >3% lebih lambat, **atau** HR > batas atas zona +3 bpm di >50% waktu rep, **atau** rep tidak selesai, **atau** RPE ≥9 (tempo/HMP). 2× gagal / 3 minggu (tipe sama) → volume sesi berikutnya −20%; 3× → zona itu +5 dtk/km | Rep tempo 5:05 vs target 4:55 (+3,4%) = gagal |
| R4 | 3 sesi kualitas berturut-turut on-pace dengan HR ≤ tengah zona & RPE ≤7 | zona itu −3…−5 dtk/km | |
| R5 | Tes 30′: LTHR = avg HR 20′ terakhir; jarak → VDOT → pace M/H/T/N/E baru. 10K TT sama | **besar**: tampilkan before/after, minta konfirmasi | 6,1 km / 30′ + HR 172 → LTHR 172, Z4 163–172 |
| R6 | RHR ≥ rata-rata 7 hari +5, **atau** tidur <6 j, **atau** pegal ≥7 | sesi kualitas hari itu → easy (atau tukar dengan easy terdekat bila lolos R8); 2 hari merah → sarankan rest | |
| R7 | Sesi terlewat: easy → abaikan; kualitas → pindah hanya bila ≥48 j dari sesi keras lain **dan** bukan H-1 long run, selain itu skip; long run → boleh ke Minggu (recovery Minggu jadi rest); absen ≥7 hari → minggu 1 = 70% tanpa kualitas, minggu 2 = 85% | Tempo Kamis terlewat → Jumat ditolak (H-1 long run); Minggu hanya bila long run Sabtu bukan sesi keras (dan ≥48 j ke Selasa berikutnya), selain itu skip |
| R8 | Guardrail: volume ≤ +10% vs rata-rata 3 minggu (kecuali setelah minggu pemulihan); ACWR 0,8–1,3 (>1,5 → kurangi otomatis); maks 2 sesi keras/minggu; tak ada 2 hari keras berturut-turut | Validator — dipanggil untuk **setiap** perubahan | |
| R9 | Suhu ≥28°C & kelembapan ≥70% | tampilan easy/long +10–20 dtk/km hari itu; kualitas dinilai dari HR/RPE (bukan gagal karena pace) | |
| R10 | Nyeri ≥4/10 atau nyeri tajam/terlokalisasi >2 hari → stop sesi kualitas + sarankan cek medis. **Red flag** (nyeri dada, sesak tak wajar, pingsan/hampir, berdebar tak teratur, HR tetap sangat tinggi lama setelah berhenti) → STOP, arahkan ke dokter, **tanpa** saran latihan | Hard-coded sebelum LLM: respons coach diganti template aman | |
| R11 | Taper (W25–W27) | hanya perubahan yang **mengurangi** beban | |
| R12 | Tangga Z4 tempo: ±20′ (W04–06) → ±30′ (W07–11) → ±40′ (W12–13) → blok HMP 9–12 km (W15–24). Rep tidak selesai karena HR/"tidak nyaman" → tempo berikutnya total Z4 sama, rep dipecah (2×10′ → 4×5′ rec 1′), anak tangga tidak naik. 2× gagal di anak tangga sama → turun 1 (−10′) + coach tinjau readiness/panas/sensor. Target tercapai RPE ≤7 dua kali → boleh naik sesuai jadwal (tak pernah lompat). 4×4: HR tidak turun <80% LTHR setelah ±3′ jog → rep sisa batal, dicatat, bukan "gagal" R3 | Contoh acceptance: berhenti menit 6 rep 2 → 4×5′ |
| R13 | `hr_source=wrist` **dan** (\|avg_hr − avg_cadence\| ≤3 **atau** lonjakan HR >20 bpm dalam <30 dtk tanpa perubahan pace) | log ditandai "kemungkinan cadence lock", HR tidak dipakai R1–R4/R12, coach sarankan chest strap | Easy wrist HR 172 / cadence 172 → ditandai, R1 tidak terpicu |

Urutan evaluasi: R10 (keselamatan) → R13 (validitas data) → R6 → R5 → R7 → R12 → R3/R4 → R1/R2 → R9 (tampilan) → validasi R8 + R11 pada hasil gabungan.
Setiap rule punya unit test minimal: 1 kasus memicu, 1 kasus tidak, 1 kasus batas.

### 6.1 Catatan implementasi M3 (keputusan yang diambil saat membangun)

- **Grandfather guardrail**: pelanggaran yang sudah ada di program asli (W12 & W27 = 3 sesi keras — D5/D6 belum diputuskan; beberapa lonjakan volume yang memang tertulis di Excel) tidak memblokir. Perubahan hanya ditolak bila **menambah** pelanggaran baru atau memperburuknya.
- **Volume +10%** hanya dinilai untuk minggu yang volumenya **naik** karena perubahan itu. Mengurangi beban satu minggu (rest R6, absen R7, ACWR) tidak dianggap "membuat minggu berikutnya melonjak".
- **R5 relatif**: pace baru = pace saat ini + (anchor Daniels VDOT-tes − anchor VDOT-acuan). Acuan awal = VDOT target HM 1:45 (42,6), lalu VDOT tes terakhir yang disetujui. Ini menjaga kalibrasi coach (mis. E sengaja lebih lambat dari rumus Daniels karena panas BSD). Usulan R5 selalu **besar** dengan opsi "LTHR saja", dan menyertakan panduan Excel (6,0–6,2 km di W05 = normal).
- **Ukuran perubahan**: menurunkan sesi kualitas jadi easy (R6, R10) dan memotong volume ≤20% (R3, R8) = kecil/otomatis karena hanya mengurangi beban. Memindah tanggal, rest, set LTHR/pace profile, geser pace >10 dtk/km = besar.
- **Konflik antar rule** pada sesi yang sama: prioritas R10 > R6 > R12 > R7 > R3 > R8 > R1 > R2 > R4 > R5 (mis. tempo gagal karena HR → R12 memecah rep; R3 tidak ikut memotong sesi yang sama).
- **R7 absen**: "minggu 1" = 7 hari setelah lari pertama setelah ≥8 hari tanpa log (kualitas → easy, ×0,7); "minggu 2" = hari 8–14 (sesi non-kualitas ×0,85).
- **R10**: nyeri ≥4/10 (check-in/log) atau nyeri terlokalisasi dilaporkan 3 hari berturut-turut → kualitas 7 hari ke depan jadi easy. Red flag → hold: tidak ada proposal/saran latihan, layar Hari ini hanya menampilkan STOP + check-in, sampai user menandai "sudah diperiksa dokter".
- **R12 4×4**: alasan berhenti "HR tidak turun <80% LTHR setelah ±3′ jog" dicatat dan dikecualikan dari R3.
- **R9** butuh suhu/kelembapan: ditambahkan ke check-in pagi (opsional) dan log.
- Engine harian (R7, R8 ACWR) berjalan saat layar Hari ini dibuka (idempoten lewat kunci dedupe); cron di M5.

## 7. AI coach

- Route `POST /api/coach` (server). Tools: `get_athlete_profile`, `get_plan(from,to)`, `get_logs(from,to)`, `get_metrics(range)`, `get_readiness(date)`, `get_z4_tolerance(range)`, `log_workout(text)` → draft terstruktur (perlu konfirmasi), `propose_plan_change(changes, rationale)` → validasi engine → diff, `apply_plan_change(version_id)` (besar → hanya bila user sudah setuju di UI), `recalc_from_test(type, distance, duration, avg_hr_last20)`, `explain_session(date)`.
- LLM tidak punya akses tulis ke `sessions`; tool handler memanggil engine yang sama dengan UI.
- **Safety pre-filter** (deterministik, sebelum LLM): kata kunci red-flag di log/chat → respons template "STOP + ke dokter (EKG/treadmill test)", sesi keras diblok sampai user menyatakan sudah diperiksa.
- Persona & cue HR 170 diambil dari sheet 🫀 (start rep 5 dtk/km lebih lambat; pelankan 5–10 dtk/km tapi selesaikan rep; napas 2:2 tempo / 2:1 4×4; chunking 1 menit; cadence 170–180; mulai rep berikut saat HR <80% LTHR). Bedakan "berat tapi normal di ambang" vs red flag.
- Model dari `ANTHROPIC_MODEL` (default `claude-opus-5-5`); prompt caching untuk tools + system prompt statis.

### 7.1 Catatan implementasi M4
- Loop tool use manual di `/api/coach` (Messages API, beta endpoint untuk `fallbacks: "default"` pada model yang mendukung; effort `medium`; tanpa `tool_choice` paksa karena Opus 5.5 menolaknya).
- `propose_plan_change` tidak menerima segmen/pace bebas: LLM memilih satu aksi (`make_easy`, `reduce_volume` 0,5–0,95, `split_reps` tempo/HM pace dengan total Z4 tetap, `rest`, `move` dalam ±6 hari, `shift_pace` −10…+30 dtk). Change dibangun dengan builder engine yang sama dengan R1–R13. Semua usulan coach disimpan `pending` (rule `coach`) atau `blocked` bila guardrail menolak.
- `apply_plan_change` hanya untuk usulan coach berukuran small. Mempercepat pace selalu large. Large hanya lewat tombol Setujui.
- `move` menolak: tanggal lewat, beda minggu, slot berisi sesi keras/long/race, sesi keras <48 jam dari sesi keras lain, sesi keras H-1 long run/shake-out/race, dan sesi keras ke hari Jumat.
- `log_workout` menerima angka yang disebut atlet (bukan teks bebas yang diparse); engine langsung berjalan.
- Red flag di chat → `safety_events` (tabel baru, RLS) → ikut `computeHold` seperti log STOP. Regex red flag diperluas ("dada terasa sesak", "dada berat", "chest tight").
- Saat hold aktif, `propose_plan_change` ditolak dan system prompt memberi tahu model.
- Feedback per log: mode baca saja (tool ubah plan tidak dikirim), disimpan di `workout_logs.coach_feedback`. Log STOP tidak mendapat feedback LLM.
- Riwayat chat di localStorage (belum disinkronkan antar perangkat).

### 7.2 Catatan implementasi M5
- PWA: `app/manifest.ts`, ikon digambar di server (`/pwa-icon/[size]`, termasuk maskable), service worker vanilla `public/sw.js` (cache-first untuk `/_next/static`, network-first + salinan offline untuk halaman/RSC, fallback `/offline`; `/api`, `/auth`, `/login` tidak pernah di-cache).
- Push: `web-push` + VAPID, tabel `push_subscriptions` (RLS), subscription 404/410 dihapus otomatis.
- Cron Vercel 05:00 & 19:00 WIB (`0 22 * * *`, `0 12 * * *` UTC). Tanpa cookie login, cron memakai service-role client lewat `runAsOwner()` (AsyncLocalStorage) dengan user id dari `OWNER_EMAIL`. Ini aman karena allowlist hanya mengizinkan satu akun; bila suatu saat multi-user, query cron wajib difilter `user_id`.
- Isi notifikasi: fungsi murni `lib/push/messages.ts` (diuji). Saat hold: tidak ada dorongan latihan.
- Header keamanan dasar (nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy).
- E2E Playwright di build produksi: navigasi, manifest/ikon, offline via SW, API key palsu tidak muncul di JS client, chat red flag → hold → clearance, auth cron.

## 8. Hasil parsing & keputusan

**Status (2026-11-17):** D1–D4, D7–D11 diterapkan sesuai usulan (D1 = kode `TJOG` 390–420). **D5 & D6 masih terbuka** — W12 dan W27 ditandai `guardrail_exception: pending_decision` di seed dan tampil ⚠ di layar Program.

Parser membaca 27 minggu × 5 hari = 135 sesi, semua baris dikenali. Pace yang **cocok persis** dengan profil langsung jadi kode. Yang tidak cocok **tidak ditebak diam-diam** — ditandai `review: true` dengan usulan (lengkap di `seed/parse_report.md`):

| # | Temuan | Usulan |
|---|---|---|
| D1 | Jog recovery tempo/HMP/fartlek ＠6:30–7:00 (16 sesi) ≠ JOG 7:00–8:00 | kode baru **`TJOG` 390–420**, *atau* JOG + adj [−30,−60] |
| D2 | Variasi long run: 5:50–6:20 (W02, W03, W26), 5:55–6:25 "ringan" (W06/10/18/22), progresif 6:00–6:10, 5:35–5:45, 5:30–5:40, 5:05–5:15 (W12, W16), 5:50–6:10 (W24) | `L` + `pace_adj_s` (ikut bergeser bila L berubah) |
| D3 | Fartlek 6×/8×250 m ＠4:15–4:30 (W02, W03 Kamis): tanpa tag zona, tidak ada di definisi "keras" | `N` + adj, hr_zone = null (effort), **is_hard = false** |
| D4 | W02 Selasa 4×400 ＠4:35–4:45 = pace N fase Base, padahal W02 = Transisi | `N` + `pace_variant: base`; tetap dihitung keras? |
| D5 | **W12 = 3 sesi keras** (Sel 4×4, Kam tempo, Sab progresif dengan 6 km ＠M) — melanggar aturan maks 2 | pilih: (a) Sab blok M jadi <5 km, (b) Selasa W12 jadi easy+strides, (c) biarkan sebagai pengecualian tercatat |
| D6 | **W27 (race week) = 3 keras** (Sel 3×700, Kam 3 km HMP, Min RACE) | race dikecualikan dari hitungan maks 2? |
| D7 | Race day ＠5:00–5:05 dan ＠4:55–4:58; strides H-1 ＠4:00 | `H` + adj (race pace terikat HM pace) / `S` + adj |
| D8 | Tangga Z4 vs isi jadwal: W09 ±24′ & W10 ±23′ (tangga 30′), W12 ±36′ (40′), W04 ±24′ (20′). W17/W22–W24 Kamis masih "Tempo" (bukan HMP) | `z4_target_min` = nilai tangga, menit terencana disimpan terpisah (`z4_planned_min`) untuk grafik |
| D9 | Selisih km segmen vs kolom km ≤0,6 km di 31 sesi (WU + strides tidak ditulis, pembulatan) | kolom km Excel = sumber kebenaran `planned_km` |
| D10 | Tes 30′ (W05): jarak tidak diketahui | estimasi 6 km (sisa km), dihitung ulang dari log |
| D11 | Long run W01 ＠6:00–6:30 dan Shake-out W27 cocok persis dengan `WU` | pakai kode `WU` (cocok persis) |

## 9. Milestone

| M | Isi | Selesai bila |
|---|---|---|
| M1 | Repo + Next.js + Supabase schema/RLS + seed dari `plan.json` + layar Program & Hari ini (read-only) | `pnpm test` hijau (pace resolver), program 27 minggu tampil dengan pace dari profil |
| M2 | Log manual + check-in + quick-log + import FIT/GPX/TCX + offline queue | log tersimpan, FIT HR/cadence/laps terbaca |
| M3 | Engine R1–R13 + guardrails + plan versioning/diff/revert + UI approval | unit test tiap rule + 6 acceptance test engine |
| M4 | Coach agent + tools + safety pre-filter + feedback otomatis | tool-call test (mock), red-flag test |
| M5 | PWA install + push + cron + deploy Vercel | install di HP, push masuk, cek bundle bebas API key |
| M6 | Strava OAuth + webhook | aktivitas baru otomatis jadi log |

## 10. Acceptance criteria → test

| Kriteria | Test |
|---|---|
| 3 easy ＠6:00 HR 160 → usul E +10 dtk/km, diff, coach jelaskan, sesi mendatang berubah | `r01.test.ts` + Playwright |
| Tes 30′ 6,1 km, HR 172 → LTHR 172, zona & pace dihitung ulang, before/after | `r05.test.ts` |
| Tempo 2×10′, berhenti menit 6 rep 2 + flag HR 170 → tempo berikutnya 4×5′, anak tangga tetap, 2–3 cue | `r12.test.ts` + coach mock |
| Wrist HR 172 / cadence 172 → cadence lock, R1 tidak terpicu | `r13.test.ts` |
| Tempo Kamis terlewat → tidak ke Jumat | `r07.test.ts` |
| "nyeri dada" → STOP + dokter | `safety.test.ts` |
| Setelah perubahan apa pun: ≤2 keras/minggu, tak ada 2 hari keras berturut-turut | property test atas guardrails |
| API key tidak di bundle; RLS hanya akun saya | grep `.next/static` + test RLS dengan user ke-2 |

## 11. Pertanyaan terbuka

Terjawab: stack = PWA Next.js; HP = **Android**; jam = **Huawei** (wrist HR → default `hr_source=wrist`, R13 penting); data dari **Huawei Health**. Huawei Health tidak punya API publik praktis untuk pemakaian pribadi → jalur utama: **Huawei Health → Strava → Strava API (M6)**, upload file GPX/TCX/FIT sebagai cadangan (M2).

Masih terbuka:
1. D5 (W12 3 sesi keras) dan D6 (race week W27).
2. Punya chest strap yang bisa dipasangkan ke jam Huawei?
