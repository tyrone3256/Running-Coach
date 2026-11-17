import type { Feedback, Tone } from "@/lib/coach/feedback";
import { cn } from "@/lib/utils";

const ICON: Record<Tone, string> = { good: "✓", info: "•", warn: "!", stop: "⛔" };
const BOX: Record<Tone, string> = {
  good: "border-emerald-500/40",
  info: "",
  warn: "border-amber-500/50",
  stop: "border-destructive bg-destructive/10 text-destructive",
};

/** Feedback coach berbasis aturan (tanpa AI). */
export function CoachFeedback({ fb, title = "Feedback coach" }: { fb: Feedback; title?: string }) {
  return (
    <section className={cn("flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm", BOX[fb.tone])}>
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="font-medium">{fb.headline}</p>
      <ul className="flex flex-col gap-1.5">
        {fb.points.map((p, i) => (
          <li key={i} className="grid grid-cols-[1rem_1fr] gap-1">
            <span className={cn(p.tone === "warn" && "text-amber-600", p.tone === "good" && "text-emerald-600")} aria-hidden>{ICON[p.tone]}</span>
            <span>{p.text}</span>
          </li>
        ))}
      </ul>
      {fb.cues.length > 0 && (
        <div className="rounded-lg bg-muted p-3">
          <p className="mb-1 text-xs font-medium">Fokus sesi kualitas berikutnya</p>
          <ul className="list-disc pl-4 text-xs leading-relaxed">{fb.cues.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      {fb.changes.length > 0 && (
        <ul className="text-xs text-muted-foreground">{fb.changes.map((c) => <li key={c}>Program: {c}</li>)}</ul>
      )}
      {fb.next && <p className="text-xs text-muted-foreground">Berikutnya: {fb.next}</p>}
    </section>
  );
}
