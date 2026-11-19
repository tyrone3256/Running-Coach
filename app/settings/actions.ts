"use server";
import { createSupabaseServer, supabaseConfigured } from "@/lib/supabase/server";

/** Atur / ganti password akun yang sedang login (setelah itu bisa masuk tanpa email). */
export async function setPassword(_prev: { ok: boolean; msg: string } | null, formData: FormData) {
  if (!supabaseConfigured()) return { ok: false, msg: "Mode lokal: tidak ada akun." };
  const pw = String(formData.get("password") ?? "");
  const pw2 = String(formData.get("password2") ?? "");
  if (pw.length < 8) return { ok: false, msg: "Minimal 8 karakter." };
  if (pw !== pw2) return { ok: false, msg: "Kedua password tidak sama." };
  const db = await createSupabaseServer();
  const { error } = await db.auth.updateUser({ password: pw });
  if (error) return { ok: false, msg: error.message.includes("weak") ? "Password terlalu lemah — pakai kombinasi huruf & angka." : "Gagal menyimpan password." };
  return { ok: true, msg: "Password tersimpan. Berikutnya masuk cukup dengan email + password." };
}
