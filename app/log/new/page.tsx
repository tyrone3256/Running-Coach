import Link from "next/link";
import { getPlan } from "@/lib/data/plan";
import { isValidIso, todayIso } from "@/lib/dates";
import { LogForm } from "@/components/log-form";
import { toSessionOptions } from "@/lib/data/session-options";

export const dynamic = "force-dynamic";

export default async function NewLogPage({
  searchParams,
}: { searchParams: Promise<{ session?: string; date?: string; quick?: string }> }) {
  const sp = await searchParams;
  const plan = await getPlan();
  const fromSession = sp.session ? plan.sessions.find((s) => s.id === sp.session) : undefined;
  const date = fromSession?.date ?? (isValidIso(sp.date) ? sp.date : todayIso());
  const quick = sp.quick === "1";
  return (
    <main className="flex flex-col gap-4">
      <nav className="text-sm"><Link href="/log" className="text-muted-foreground hover:underline">← Log</Link></nav>
      <h1 className="text-2xl font-semibold">{quick ? "Log cepat" : "Log lari"}</h1>
      <LogForm initial={{ date }} sessions={toSessionOptions(plan.sessions)} quick={quick} />
    </main>
  );
}
