import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Button } from "@/components/ui/button";
import { createSupabaseServer, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function sendLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/login?e=kosong");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const db = await createSupabaseServer();
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  // Pesan generik: tidak membocorkan apakah email ada di allowlist.
  redirect(error ? "/login?e=gagal" : "/login?sent=1");
}

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ sent?: string; e?: string }> }) {
  if (!supabaseConfigured()) redirect("/");
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">Running Coach</h1>
        <p className="text-sm text-muted-foreground">Masuk dengan magic link ke email kamu.</p>
      </div>
      {sp.sent ? (
        <p className="rounded-lg bg-muted p-3 text-sm">Cek email kamu dan buka link masuk dari HP ini.</p>
      ) : (
        <form action={sendLink} className="flex flex-col gap-3">
          <input
            name="email" type="email" required autoComplete="email" placeholder="email"
            className="h-11 rounded-lg border bg-background px-3 text-base"
          />
          <Button type="submit" className="h-11">Kirim link masuk</Button>
          {sp.e && <p className="text-sm text-destructive">Gagal mengirim link. Coba lagi.</p>}
        </form>
      )}
    </main>
  );
}
