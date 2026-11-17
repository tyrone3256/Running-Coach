import Link from "next/link";
import type { OutcomeSummary } from "@/lib/data/outcome";
import { cn } from "@/lib/utils";

/** Ringkasan apa yang dilakukan adaptive engine setelah log / check-in. */
export function EngineOutcome({ o }: { o: OutcomeSummary | null | undefined }) {
  if (!o) return null;
  const empty = !o.applied.length && !o.pending.length && !o.blocked.length && !o.notices.length;
  if (empty) return <p className="text-xs text-muted-foreground">Program tidak berubah.</p>;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {o.applied.map((c) => (
        <div key={c.id} className="rounded-lg border bg-background p-3">
          <p className="font-medium">Program disesuaikan · {c.rule}</p>
          <p>{c.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{c.reason}</p>
          {c.cues && c.cues.length > 0 && (
            <ul className="mt-2 list-disc pl-4 text-xs">
              {c.cues.map((q) => <li key={q}>{q}</li>)}
            </ul>
          )}
        </div>
      ))}
      {o.pending.map((c) => (
        <div key={c.id} className="rounded-lg border border-amber-500/50 bg-background p-3">
          <p className="font-medium">Butuh persetujuanmu · {c.rule}</p>
          <p>{c.title}</p>
        </div>
      ))}
      {o.blocked.map((c) => (
        <div key={c.id} className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
          {c.rule} ditahan guardrail: {c.why.join("; ")}
        </div>
      ))}
      {o.notices.map((n, i) => (
        <p key={i} className={cn("rounded-lg p-3 text-xs", n.level === "stop" ? "bg-destructive/10 text-destructive" : n.level === "warn" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-muted")}>
          {n.rule}: {n.message}
        </p>
      ))}
      {(o.applied.length > 0 || o.pending.length > 0) && (
        <Link href="/program/changes" className="text-xs underline">Lihat semua perubahan program →</Link>
      )}
    </div>
  );
}
