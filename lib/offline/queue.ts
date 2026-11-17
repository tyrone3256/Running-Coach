"use client";
// Antrean kiriman saat sinyal hilang (IndexedDB). Dikirim ulang otomatis saat online.
import { get, set } from "idb-keyval";

const KEY = "rc-outbox-v1";
export const QUEUE_EVENT = "rc-queue-changed";

interface Item { id: string; url: string; body: unknown; queued_at: string }

async function read(): Promise<Item[]> {
  try {
    return ((await get(KEY)) as Item[] | undefined) ?? [];
  } catch {
    return [];
  }
}

async function write(items: Item[]) {
  await set(KEY, items);
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: items.length }));
}

export async function queueSize(): Promise<number> {
  return (await read()).length;
}

export type PostResult<T> =
  | { status: "sent"; ok: boolean; httpStatus: number; data: T }
  | { status: "queued" };

/** POST JSON; bila jaringan gagal → simpan di antrean dan kembalikan "queued". */
export async function postJson<T = unknown>(url: string, body: unknown): Promise<PostResult<T>> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return enqueue(url, body);
  try {
    const res = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as T;
    return { status: "sent", ok: res.ok, httpStatus: res.status, data };
  } catch {
    return enqueue(url, body);
  }
}

async function enqueue(url: string, body: unknown): Promise<{ status: "queued" }> {
  const items = await read();
  items.push({ id: crypto.randomUUID(), url, body, queued_at: new Date().toISOString() });
  await write(items);
  return { status: "queued" };
}

let flushing = false;
/** Kirim ulang semua item. Item dihapus bila server menjawab (2xx/4xx); tetap bila jaringan gagal / 5xx. */
export async function flushQueue(): Promise<{ sent: number; left: number }> {
  if (flushing) return { sent: 0, left: await queueSize() };
  flushing = true;
  try {
    const items = await read();
    const left: Item[] = [];
    let sent = 0;
    for (const it of items) {
      try {
        const res = await fetch(it.url, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(it.body),
        });
        if (res.status >= 500) left.push(it);
        else sent++;
      } catch {
        left.push(it);
      }
    }
    await write(left);
    return { sent, left: left.length };
  } finally {
    flushing = false;
  }
}
