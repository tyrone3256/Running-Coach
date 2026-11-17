// Teks tetap coach (tanpa AI): tujuan sesi & panduan yang sering ditanyakan.
import type { SessionType } from "@/lib/engine/types";

export const PURPOSE: Record<SessionType, string> = {
  easy: "Basis aerobik. HR Z2, napas masih bisa ngobrol.",
  easy_strides: "Easy + strides untuk ekonomi lari & kadens tanpa beban metabolik.",
  easy_hill: "Easy + sprint tanjakan pendek untuk kekuatan; recovery penuh antar rep.",
  recovery: "Pemulihan aktif. Sangat pelan, Z1.",
  vo2_4x4: "VO2max (Norwegian 4×4): Z4–Z5, recovery jog 3′.",
  tempo: "Threshold: membangun toleransi di Z4 (tangga menit Z4) — inti target sub-1:45.",
  hm_pace: "Membiasakan pace race 4:55–5:00/km.",
  fartlek: "Variasi ringan berdasarkan rasa — bukan sesi keras.",
  test_30min: "Tes LTHR: rata-rata HR 20 menit terakhir = LTHR baru. Masukkan hasilnya di Program → Input hasil tes.",
  tt_10k: "Time trial 10K untuk kalibrasi pace.",
  long: "Daya tahan aerobik. Pelan & rata.",
  long_with_pace: "Long run dengan blok pace race di akhir.",
  long_progressive: "Long run progresif — akhir mendekati pace M/H.",
  long_race_sim: "Simulasi race: perlengkapan, nutrisi, pacing.",
  shakeout: "Shake-out H-1: pendek & ringan.",
  race: "Race day.",
};

export const HR170_NORMAL = [
  "Napas berat tapi teratur, kaki panas, ingin berhenti.",
  "HR 165–172 di rep tempo, RPE 7–8.",
  "Pulih dalam 1–2 menit jog setelah rep.",
];

export const HR170_DANGER = [
  "Nyeri, tekanan, atau rasa diremas di dada.",
  "Sesak yang tidak wajar / tidak membaik saat berhenti.",
  "Pusing berat, pandangan gelap, hampir pingsan.",
  "Jantung berdebar tidak teratur.",
  "HR tetap sangat tinggi lama setelah berhenti.",
  "HR melonjak >20 bpm tiba-tiba tanpa pace berubah — sering sensor; kalau disertai gejala di atas, anggap bahaya.",
];

export const MISSED_RULES = [
  "Sesi easy terlewat: tidak diganti. Volume minggu itu memang turun sedikit, itu aman.",
  "Sesi kualitas terlewat: dipindah hanya bila masih ada hari di minggu yang sama dengan jarak ≥48 jam dari sesi keras lain dan bukan H-1 long run. Tempo Kamis tidak pernah pindah ke Jumat.",
  "Long run Sabtu terlewat: boleh pindah ke Minggu (Minggu jadi easy/rest).",
  "Absen 3–6 hari: minggu berikutnya dikurangi; ≥7 hari: masuk ulang bertahap.",
  "Semua pemindahan muncul sebagai usulan di Program → Perubahan program untuk kamu setujui.",
];
