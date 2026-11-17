"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { flushQueue, QUEUE_EVENT, queueSize } from "@/lib/offline/queue";

/** Badge antrean offline + kirim ulang otomatis saat online. */
export function OfflineSync() {
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const refresh = () => queueSize().then(setPending);
    const tryFlush = async () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) return;
      const r = await flushQueue();
      setPending(r.left);
      if (r.sent) router.refresh();
    };
    const onChange = (e: Event) => setPending((e as CustomEvent<number>).detail);
    const onOffline = () => setOnline(false);
    refresh();
    tryFlush();
    window.addEventListener("online", tryFlush);
    window.addEventListener("offline", onOffline);
    window.addEventListener(QUEUE_EVENT, onChange);
    return () => {
      window.removeEventListener("online", tryFlush);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(QUEUE_EVENT, onChange);
    };
  }, [router]);

  if (!pending && online) return null;
  return (
    <div role="status" className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      {!online && "Offline. "}
      {pending > 0 && `${pending} kiriman menunggu sinyal — dikirim otomatis saat online.`}
    </div>
  );
}
