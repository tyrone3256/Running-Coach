import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlan } from "@/lib/data/plan";
import { SessionCard } from "@/components/session-card";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await getPlan();
  const idx = plan.sessions.findIndex((s) => s.id === id);
  if (idx < 0) notFound();
  const s = plan.sessions[idx];
  const prev = plan.sessions[idx - 1];
  const next = plan.sessions[idx + 1];
  return (
    <main className="flex flex-col gap-4">
      <nav className="flex justify-between text-sm">
        <Link href="/program" className="text-muted-foreground hover:underline">← Program</Link>
        <span className="flex gap-4">
          {prev && <Link href={`/program/${prev.id}`} className="hover:underline">‹ {prev.id}</Link>}
          {next && <Link href={`/program/${next.id}`} className="hover:underline">{next.id} ›</Link>}
        </span>
      </nav>
      <SessionCard session={s} pace={plan.paceProfile} hr={plan.hrProfile} />
      <details className="rounded-xl border bg-card px-4 py-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Teks asli Excel</summary>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{s.source_text}</pre>
      </details>
    </main>
  );
}
