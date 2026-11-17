import Link from "next/link";
import { getPlan } from "@/lib/data/plan";
import { ImportForm } from "@/components/import-form";
import { toSessionOptions } from "@/lib/data/session-options";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const plan = await getPlan();
  return (
    <main className="flex flex-col gap-4">
      <nav className="text-sm"><Link href="/log" className="text-muted-foreground hover:underline">← Log</Link></nav>
      <h1 className="text-2xl font-semibold">Import file</h1>
      <ImportForm sessions={toSessionOptions(plan.sessions)} lthr={plan.hrProfile.lthr} />
    </main>
  );
}
