"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChangeActions } from "@/components/change-actions";

interface Effect { kind: "proposal" | "applied" | "log" | "test"; id: string; title: string; mode?: string; size?: string }
interface Msg { role: "user" | "assistant"; content: string; effects?: Effect[]; stop?: boolean }

const KEY = "coach-chat-v1";
const HISTORY_SENT = 20; // giliran terakhir yang dikirim ke server

const STARTERS = [
  "Sesi hari ini apa, dan apa yang harus kufokuskan?",
  "Bagaimana toleransi Z4-ku 3 minggu terakhir?",
  "HR-ku 172 saat tempo dan rasanya berat. Normal?",
  "Aku harus lembur Kamis, tempo-nya bagaimana?",
];

function EffectCard({ e }: { e: Effect }) {
  if (e.kind === "log") return <Link href={`/log/${e.id}`} className="block rounded-lg border px-3 py-2 text-xs underline">📝 {e.title}</Link>;
  if (e.kind === "applied") return <p className="rounded-lg border px-3 py-2 text-xs">✅ {e.title}</p>;
  return (
    <div className="flex flex-col gap-2 rounded-lg border px-3 py-2 text-xs">
      <p>
        <b>{e.mode === "blocked" ? "Ditolak guardrail" : e.size === "large" ? "Butuh persetujuanmu" : "Usulan kecil"}</b> · {e.title}
      </p>
      {e.mode === "pending" && e.size === "large" && <ChangeActions id={e.id} mode="pending" canRevert={false} />}
      <Link href="/program/changes" className="text-muted-foreground underline">Lihat di Perubahan program</Link>
    </div>
  );
}

export function CoachChat({ aiReady, model }: { aiReady: boolean; model: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setMsgs(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { /* kosong */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(KEY, JSON.stringify(msgs.slice(-100)));
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loaded]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next);
    setInput("");
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/coach", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-HISTORY_SENT).map(({ role, content }) => ({ role, content: content.slice(0, 4000) })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Gagal (${res.status})`);
      setMsgs([...next, { role: "assistant", content: data.text, effects: data.effects, stop: data.safetyStop }]);
    } catch (e) {
      setErr(navigator.onLine ? (e as Error).message : "Offline — coach butuh koneksi internet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-[calc(100dvh-8rem)] flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Coach</h1>
        {msgs.length > 0 && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setMsgs([])}>Percakapan baru</button>
        )}
      </header>
      {!aiReady && (
        <p className="rounded-xl border bg-muted p-3 text-sm">
          Coach AI belum aktif (ANTHROPIC_API_KEY belum diisi). Cek keselamatan tetap jalan: keluhan red flag langsung dijawab STOP.
        </p>
      )}
      {msgs.length === 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Tanya soal sesi, HR, log, atau minta penyesuaian. Coach membaca plan & log-mu lewat tool; perubahan besar tetap kamu yang setujui.
          </p>
          {STARTERS.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted">{s}</button>
          ))}
        </div>
      )}
      <ol className="flex flex-1 flex-col gap-3">
        {msgs.map((m, i) => (
          <li key={i} className={m.role === "user" ? "max-w-[85%] self-end" : "max-w-[95%]"}>
            <div className={
              m.role === "user" ? "rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                : m.stop ? "rounded-2xl rounded-bl-sm border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  : "rounded-2xl rounded-bl-sm border bg-card px-3 py-2 text-sm"
            }>
              <p className="whitespace-pre-line leading-relaxed">{m.content}</p>
            </div>
            {m.effects?.length ? (
              <div className="mt-2 flex flex-col gap-2">{m.effects.map((e) => <EffectCard key={e.id + e.kind} e={e} />)}</div>
            ) : null}
          </li>
        ))}
        {busy && <li className="text-sm text-muted-foreground">Coach sedang mengecek data…</li>}
      </ol>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div ref={end} />
      <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="sticky bottom-20 flex gap-2 bg-background py-2">
        <textarea
          value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={4000}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          placeholder="Tulis pesan…" aria-label="Pesan untuk coach"
          className="min-h-11 flex-1 resize-none rounded-lg border bg-background px-3 py-2.5 text-base"
        />
        <Button type="submit" className="h-11" disabled={busy || !input.trim()}>Kirim</Button>
      </form>
      <p className="text-center text-[11px] text-muted-foreground">Bukan nasihat medis · {model}</p>
    </main>
  );
}
