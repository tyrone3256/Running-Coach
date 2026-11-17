import Link from "next/link";
import type { InboxItem } from "@/lib/strava/store";
import { formatDateId, todayIso } from "@/lib/dates";
import { formatDuration } from "@/lib/log/units";

/** Daftar aktivitas Strava yang menunggu dilengkapi (RPE, rasa, nyeri). */
export function StravaInboxList({ items }: { items: InboxItem[] }) {
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm dark:bg-orange-950/30">
      <p className="font-medium">Dari Strava — lengkapi dulu ({items.length})</p>
      <ul className="flex flex-col gap-1">
        {items.map((i) => (
          <li key={i.activity_id}>
            <Link href={`/log/strava/${i.activity_id}`} className="flex justify-between gap-2 rounded-lg bg-background px-3 py-2 hover:bg-muted">
              <span>{formatDateId(todayIso(new Date(i.start_date)))} · {i.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {(i.draft.log.distance_m / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} km · {formatDuration(i.draft.log.duration_s)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
