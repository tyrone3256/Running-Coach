// Membuat contoh FIT (tempo W12 Kamis, rep 3 berhenti di menit ke-6) untuk uji import manual.
//   npx tsx scripts/make-sample-fit.ts <output.fit>
import { writeFileSync } from "node:fs";
import { Encoder, Profile } from "@garmin/fitsdk";

const out = process.argv[2] ?? "sample-tempo.fit";
const START = Date.UTC(2027, 1, 10, 23, 5, 0); // Kamis 11 Feb 2027 06:05 WIB
// [detik, pace dtk/km, hr]
const blocks: Array<[number, number, number]> = [
  [1080, 375, 140], [730, 292, 166], [100, 400, 148], [730, 292, 169], [100, 400, 150],
  [360, 296, 173], [60, 420, 160], [900, 380, 145],
];
const M = (o: Record<string, unknown>) => o as never;
const enc = new Encoder();
enc.onMesg(Profile.MesgNum.FILE_ID, M({ manufacturer: "development", product: 1, timeCreated: new Date(START), type: "activity" }));
let t = 0;
let d = 0;
for (const [dur, pace, hr] of blocks) {
  for (let i = 0; i < dur; i++, t++, d += 1000 / pace) {
    enc.onMesg(Profile.MesgNum.RECORD, M({ timestamp: new Date(START + t * 1000), distance: d, heartRate: hr, cadence: 88 }));
  }
}
enc.onMesg(Profile.MesgNum.SESSION, M({
  timestamp: new Date(START + t * 1000), startTime: new Date(START), sport: "running",
  totalTimerTime: t, totalElapsedTime: t, totalDistance: d,
}));
writeFileSync(out, enc.close());
console.log(`OK ${out}: ${(d / 1000).toFixed(2)} km, ${t} dtk`);
