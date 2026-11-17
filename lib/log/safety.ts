// Deteksi keselamatan deterministik (dasar R10). Dipanggil SEBELUM apa pun lainnya
// (engine, coach). Red flag → STOP: tanpa saran latihan, arahkan ke dokter.
import { RED_FLAGS, type SafetyResult, type WorkoutLogInput } from "./schema";

// Kata kunci di teks bebas (catatan log / chat). Sengaja konservatif: lebih baik false positive.
const RED_FLAG_PATTERNS: Array<[RegExp, string]> = [
  [/nyeri\s*(di\s*)?dada|dada\s*(sakit|nyeri|sesak|tertekan|berat)|sakit\s*(di\s*)?dada|chest\s*pain/i, "nyeri dada"],
  [/sesak\s*(napas|nafas)?\s*(tidak|gak|nggak|ga)\s*wajar|sesak\s*berat|tidak\s*bisa\s*(napas|nafas)/i, "sesak tidak wajar"],
  [/pingsan|hampir\s*pingsan|mau\s*pingsan|kunang|black\s*out|blackout/i, "pingsan / hampir pingsan"],
  [/(berdebar|deg-?degan)\s*(tidak|gak|nggak|ga)\s*(teratur|beraturan)|jantung\s*(tidak|gak)\s*teratur|palpitasi|aritmia/i, "jantung berdebar tidak teratur"],
  [/hr\s*(tetap|masih)\s*(sangat\s*)?tinggi\s*(lama\s*)?(setelah|sesudah)\s*berhenti/i, "HR tetap tinggi setelah berhenti"],
];

export function detectRedFlagText(text: string | null | undefined): string[] {
  if (!text) return [];
  return RED_FLAG_PATTERNS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

export function assessLogSafety(log: Pick<WorkoutLogInput, "red_flags" | "notes" | "pain">): SafetyResult {
  const flagged = log.red_flags.map((id) => RED_FLAGS.find((f) => f.id === id)!.label);
  const fromText = detectRedFlagText(log.notes);
  const reasons = [...new Set([...flagged, ...fromText])];
  if (reasons.length) return { level: "stop", reasons };
  if (log.pain.score >= 4 || log.pain.sharp) {
    return {
      level: "medical_check",
      reasons: [
        log.pain.sharp ? "nyeri tajam/terlokalisasi" : `nyeri ${log.pain.score}/10`,
        ...(log.pain.location ? [`lokasi: ${log.pain.location}`] : []),
      ],
    };
  }
  return { level: "ok", reasons: [] };
}

export const STOP_MESSAGE =
  "STOP latihan. Gejala ini termasuk red flag. Jangan lanjut sesi apa pun dan segera periksa ke dokter " +
  "(minta EKG / treadmill stress test). Bila gejala berat atau masih berlangsung, hubungi 119 / IGD terdekat. " +
  "Coach tidak memberi saran latihan sampai kamu menyatakan sudah diperiksa.";
