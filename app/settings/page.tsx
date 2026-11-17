import Link from "next/link";
import { getPlan } from "@/lib/data/plan";
import { PushSettings } from "@/components/push-settings";
import { InstallApp } from "@/components/install-app";
import { SignOutButton } from "@/components/sign-out-button";
import { supabaseConfigured } from "@/lib/supabase/server";
import { coachModel } from "@/lib/coach/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const plan = await getPlan();
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
  return (
    <main className="flex flex-col gap-4">
      <nav className="text-sm"><Link href="/" className="text-muted-foreground hover:underline">← Hari ini</Link></nav>
      <h1 className="text-2xl font-semibold">Pengaturan</h1>
      <InstallApp />
      <PushSettings vapidKey={vapid} />
      <section className="flex flex-col gap-1 rounded-xl border bg-card p-4 text-sm">
        <p className="font-medium">Status</p>
        <p>Data: {plan.source === "supabase" ? "Supabase (akun kamu, RLS)" : plan.source === "local" ? "lokal (.local-data)" : "seed (read-only)"}</p>
        <p>Plan versi {plan.planVersion} · LTHR {plan.hrProfile.lthr} ({plan.hrProfile.source === "test" ? "hasil tes" : "sementara"})</p>
        <p>Coach AI: {process.env.ANTHROPIC_API_KEY ? `aktif (${coachModel()})` : "belum aktif"}</p>
        <p className="flex gap-3 pt-1">
          <Link href="/program/changes" className="underline">Perubahan program</Link>
          <Link href="/program/test" className="underline">Input hasil tes</Link>
        </p>
      </section>
      {supabaseConfigured() && <SignOutButton />}
    </main>
  );
}
