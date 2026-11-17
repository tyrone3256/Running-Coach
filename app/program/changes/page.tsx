import Link from "next/link";
import { getPlanStore } from "@/lib/data/plan-store";
import { ChangeActions } from "@/components/change-actions";
import { Badge } from "@/components/ui/badge";
import { formatDateId } from "@/lib/dates";
import type { PlanChangeRecord } from "@/lib/engine/model";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MODE_LABEL: Record<PlanChangeRecord["mode"], string> = {
  pending: "menunggu persetujuan", auto: "otomatis", approved: "disetujui", rejected: "ditolak", blocked: "ditahan guardrail",
};

function ChangeCard({ c }: { c: PlanChangeRecord }) {
  const reverted = !!c.reverted_by;
  return (
    <li className={cn("flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm", c.mode === "pending" && "border-amber-500/60", reverted && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{c.rule}</Badge>
        <span>{MODE_LABEL[c.mode]}{reverted ? " · di-revert" : ""}</span>
        <span>· {c.size === "small" ? "kecil" : "besar"}</span>
        <span>· {formatDateId(c.date, { weekday: undefined, month: "short" })}</span>
        {c.to_version && <span>· v{c.from_version}→v{c.to_version}</span>}
      </div>
      <p className="font-medium">{c.title}</p>
      <p className="text-muted-foreground">{c.reason}</p>
      {c.diff.length > 0 && (
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted-foreground"><tr><th className="text-left font-normal">Item</th><th className="text-left font-normal">Sebelum</th><th className="text-left font-normal">Sesudah</th></tr></thead>
          <tbody>
            {c.diff.map((d) => (
              <tr key={d.kind + d.id} className="border-t align-top">
                <td className="py-1 pr-2">{d.label}</td>
                <td className="py-1 pr-2 text-muted-foreground line-through decoration-muted-foreground/40">{d.before}</td>
                <td className="py-1 font-medium">{d.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {c.cues && c.cues.length > 0 && (
        <ul className="list-disc pl-4 text-xs">{c.cues.map((q) => <li key={q}>{q}</li>)}</ul>
      )}
      {c.blocked_by && c.blocked_by.length > 0 && (
        <p className="text-xs text-destructive">Guardrail: {c.blocked_by.join("; ")}</p>
      )}
      <ChangeActions id={c.id} mode={c.mode} alternatives={c.alternatives?.map(({ id, label }) => ({ id, label }))}
        canRevert={(c.mode === "auto" || c.mode === "approved") && !reverted && !!c.inverse && !c.reverts} />
    </li>
  );
}

export default async function ChangesPage() {
  const ps = getPlanStore();
  const [changes, notices, active] = await Promise.all([ps.listChanges(), ps.listNotices(), ps.getActive()]);
  const pending = changes.filter((c) => c.mode === "pending");
  const rest = changes.filter((c) => c.mode !== "pending");
  return (
    <main className="flex flex-col gap-4">
      <nav className="flex justify-between text-sm">
        <Link href="/program" className="text-muted-foreground hover:underline">← Program</Link>
        <Link href="/program/test" className="underline">Input hasil tes →</Link>
      </nav>
      <header>
        <h1 className="text-2xl font-semibold">Perubahan program</h1>
        <p className="text-sm text-muted-foreground">
          Plan v{active.version} · LTHR {active.lthr} ({active.lthrSource === "test" ? "hasil tes" : "sementara"}).
          Perubahan kecil (≤10 dtk/km atau ≤20% volume 1 sesi) otomatis; perubahan besar menunggu persetujuanmu. Semua bisa di-revert.
        </p>
      </header>
      {pending.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Menunggu persetujuan ({pending.length})</h2>
          <ul className="flex flex-col gap-2">{pending.map((c) => <ChangeCard key={c.id} c={c} />)}</ul>
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Riwayat</h2>
        {rest.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada perubahan — program masih sesuai Excel.</p>
          : <ul className="flex flex-col gap-2">{rest.map((c) => <ChangeCard key={c.id} c={c} />)}</ul>}
      </section>
      {notices.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Catatan engine</h2>
          <ul className="flex flex-col gap-1 text-xs">
            {notices.slice(0, 30).map((n) => (
              <li key={n.key} className={cn("rounded-lg p-2", n.level === "stop" ? "bg-destructive/10 text-destructive" : n.level === "warn" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-muted")}>
                <b>{n.rule}</b> · {n.date} · {n.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
