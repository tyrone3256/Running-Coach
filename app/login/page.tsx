import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Button } from "@/components/ui/button";
import { createSupabaseServer, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function signInPassword(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/login?e=kosong");
  const db = await createSupabaseServer();
  const { error } = await db.auth.signInWithPassword({ email, password });
  // Pesan generik: tidak membocorkan apakah email terdaftar.
  redirect(error ? "/login?e=salah" : "/");
}

async function sendLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/login?mode=link&e=kosong");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const db = await createSupabaseServer();
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: false },
  });
  redirect(error ? "/login?mode=link&e=gagal" : "/login?mode=link&sent=1");
}

const inputCls = "h-11 rounded-lg border bg-background px-3 text-base";

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ sent?: string; e?: string; mode?: string }> }) {
  if (!supabaseConfigured()) redirect("/");
  const sp = await searchParams;
  const link = sp.mode === "link";
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">Running Coach</h1>
        <p className="text-sm text-muted-foreground">
          {link ? "Masuk dengan link ke email (cadangan bila lupa password)." : "Masuk dengan email & password. Sesi tersimpan di perangkat ini."}
        </p>
      </div>

      {link ? (
        sp.sent ? (
          <p className="rounded-lg bg-muted p-3 text-sm">Cek email kamu dan buka link masuk di perangkat ini. Setelah masuk, atur password di ⚙ Pengaturan.</p>
        ) : (
          <form action={sendLink} className="flex flex-col gap-3">
            <input name="email" type="email" required autoComplete="email" placeholder="email" aria-label="Email" className={inputCls} />
            <Button type="submit" className="h-11">Kirim link masuk</Button>
            {sp.e && <p className="text-sm text-destructive">Gagal mengirim link. Coba lagi beberapa menit lagi.</p>}
          </form>
        )
      ) : (
        <form action={signInPassword} className="flex flex-col gap-3">
          <input name="email" type="email" required autoComplete="username" placeholder="email" aria-label="Email" className={inputCls} />
          <input name="password" type="password" required autoComplete="current-password" placeholder="password" aria-label="Password" className={inputCls} />
          <Button type="submit" className="h-11">Masuk</Button>
          {sp.e && <p className="text-sm text-destructive">Email atau password salah.</p>}
        </form>
      )}

      <a href={link ? "/login" : "/login?mode=link"} className="text-center text-sm text-muted-foreground underline">
        {link ? "Masuk dengan password" : "Belum punya / lupa password? Masuk lewat link email"}
      </a>
    </main>
  );
}
