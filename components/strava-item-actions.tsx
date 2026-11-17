"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Abaikan aktivitas Strava (mis. jalan kaki yang tercatat sebagai lari) atau kembalikan. */
export function StravaItemActions({ activityId, dismissed }: { activityId: number; dismissed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(action: "dismiss" | "restore") {
    setBusy(true);
    await fetch("/api/strava", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, activity_id: activityId }) });
    setBusy(false);
    if (action === "dismiss") router.push("/log"); else router.refresh();
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <button type="button" disabled={busy} className="self-start text-muted-foreground underline"
        onClick={() => act(dismissed ? "restore" : "dismiss")}>
        {dismissed ? "Kembalikan ke daftar" : "Abaikan aktivitas ini (bukan latihan program)"}
      </button>
      <a href={`https://www.strava.com/activities/${activityId}`} target="_blank" rel="noopener noreferrer"
        className="self-start text-xs text-[#FC5200] underline">View on Strava</a>
    </div>
  );
}
