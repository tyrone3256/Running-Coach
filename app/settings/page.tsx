import Link from "next/link";
import { getPlan } from "@/lib/data/plan";
import { formatHr, zoneTable } from "@/lib/engine/pace";
import { PushSettings } from "@/components/push-settings";
import { InstallApp } from "@/components/install-app";
import { SignOutButton } from "@/components/sign-out-button";
import { supabaseConfigured } from "@/lib/supabase/server";
import { StravaSettings } from "@/components/strava-settings";
import { stravaConfigured } from "@/lib/strava/server";
import { getStravaStore } from "@/lib/strava/store";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ strava?: string }> }) {
  const [plan, sp, strava] = await Promise.all([
    getPlan(), searchParams, stravaConfigured() ? getStravaStore().getConnection().catch(() => null) : Promise.resolve(null),
  ]);
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
  return (
    <main className="flex flex-col gap-4">
      <nav className="text-sm"><Link href="/" className="text-muted-foreground hover:underline">← Hari ini</Link></nav>
      <h1 className="text-2xl font-semibold">Pengaturan</h1>
      <InstallApp />
      <section id="zona" className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
        <p className="font-medium">Zona HR (LTHR {plan.hrProfile.lthr})</p>
        <table className="w-full tabular-nums">
          <tbody>
            {zoneTable(plan.hrProfile.lthr).map((z) => (
              <tr key={z.zone} className="border-t">
                <td className="py-1 font-medium">{z.zone}</td>
                <td className="text-muted-foreground">{z.pct[0] === 0 ? `< ${z.pct[1] + 1}%` : `${z.pct[0]}–${z.pct[1]}%`}</td>
                <td className="text-right">{formatHr(z.bpm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted-foreground">
          Supaya &quot;waktu di zona&quot; di Huawei Health / Strava bisa langsung disalin ke log, samakan batas zonanya dengan tabel ini:
        </p>
        <ul className="list-disc pl-4 text-muted-foreground">
          <li>Huawei Health: Saya → Pengaturan olahraga → zona detak jantung. Pilih metode ambang laktat (LTHR) bila tersedia dan isi {plan.hrProfile.lthr}, lalu cek angkanya sama dengan tabel; bila tidak tersedia, atur batas zona manual.</li>
          <li>Strava (web): Settings → My Performance → Heart Rate → zona kustom (bila tersedia di akunmu).</li>
          <li>Kalau batasnya berbeda, kosongkan kolom zona di log — kolom lain tetap cukup.</li>
        </ul>
        <p className="text-xs text-muted-foreground">LTHR diperbarui setelah tes W05 (Program → Input hasil tes); ingat ubah juga di jam.</p>
      </section>
      {stravaConfigured() && (
        <StravaSettings
          configured athlete={strava ? strava.athlete_name ?? `atlet #${strava.athlete_id}` : null}
          lastSync={strava?.last_sync_at ?? null} status={sp.strava ?? null}
        />
      )}
      <PushSettings vapidKey={vapid} />
      <section className="flex flex-col gap-1 rounded-xl border bg-card p-4 text-sm">
        <p className="font-medium">Status</p>
        <p>Data: {plan.source === "supabase" ? "Supabase (akun kamu, RLS)" : plan.source === "local" ? "lokal (.local-data)" : "seed (read-only)"}</p>
        <p>Plan versi {plan.planVersion} · LTHR {plan.hrProfile.lthr} ({plan.hrProfile.source === "test" ? "hasil tes" : "sementara"})</p>
        <p className="flex gap-3 pt-1">
          <Link href="/program/changes" className="underline">Perubahan program</Link>
          <Link href="/program/test" className="underline">Input hasil tes</Link>
        </p>
      </section>
      {supabaseConfigured() && <SignOutButton />}
    </main>
  );
}
