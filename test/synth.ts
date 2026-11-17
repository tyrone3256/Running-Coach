import type { Sample } from "@/lib/log/activity";

/** Sesi sintetis 1 Hz: blok [durasi dtk, pace dtk/km, hr]. */
export function synth(blocks: Array<[number, number, number]>, cad = 172): Sample[] {
  const out: Sample[] = [];
  let t = 0;
  let d = 0;
  for (const [dur, pace, hr] of blocks) {
    for (let i = 0; i < dur; i++) {
      out.push({ t, d, hr, cad });
      t += 1;
      d += 1000 / pace;
    }
  }
  out.push({ t, d, hr: blocks[blocks.length - 1][2], cad });
  return out;
}

