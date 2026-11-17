// Konstanta tanpa dependensi (aman untuk bundle client).
export const RED_FLAGS = [
  { id: "chest_pain", label: "Nyeri / tekanan di dada" },
  { id: "abnormal_breathless", label: "Sesak tidak wajar" },
  { id: "faint", label: "Pingsan / hampir pingsan / pusing berat" },
  { id: "palpitations", label: "Jantung berdebar tidak teratur" },
  { id: "hr_stays_high", label: "HR tetap sangat tinggi lama setelah berhenti" },
] as const;
export type RedFlagId = (typeof RED_FLAGS)[number]["id"];

export const STOP_REASONS = ["hr_tidak_nyaman", "lelah", "nyeri", "panas", "waktu", "lainnya"] as const;
export const STOP_REASON_LABEL: Record<(typeof STOP_REASONS)[number], string> = {
  hr_tidak_nyaman: "HR 170 / tidak nyaman",
  lelah: "Lelah",
  nyeri: "Nyeri",
  panas: "Panas",
  waktu: "Waktu",
  lainnya: "Lainnya",
};

