"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ChangeActions({ id, mode, alternatives, canRevert }: {
  id: string;
  mode: string;
  alternatives?: Array<{ id: string; label: string }>;
  canRevert: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);

  async function act(action: "approve" | "reject" | "revert", alternative?: string) {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/changes/${id}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, alternative: alternative ?? null }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || data.ok === false) {
      setErr(data.error ?? `Ditahan guardrail: ${(data.violations ?? []).join("; ")}`);
      return;
    }
    router.refresh();
  }

  if (mode === "pending") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => act("approve")}>Setujui</Button>
          {alternatives?.map((a) => (
            <Button key={a.id} size="sm" variant="outline" disabled={busy} onClick={() => act("approve", a.id)}>{a.label}</Button>
          ))}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("reject")}>Tolak</Button>
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>
    );
  }
  if (canRevert) {
    return (
      <div className="flex flex-col gap-1">
        {confirmRevert ? (
          <div className="flex items-center gap-2 text-xs">
            <span>Kembalikan program ke sebelum perubahan ini?</span>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => act("revert")}>Revert</Button>
            <button type="button" className="underline" onClick={() => setConfirmRevert(false)}>Batal</button>
          </div>
        ) : (
          <button type="button" className="self-start text-xs underline" onClick={() => setConfirmRevert(true)}>Revert</button>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>
    );
  }
  return null;
}
