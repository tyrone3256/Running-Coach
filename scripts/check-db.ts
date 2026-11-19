// Cek cepat: semua tabel & kolom migrasi ada di Supabase. Tidak menampilkan kunci.
//   npx tsx --env-file=.env.local scripts/check-db.ts
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const tables = [
  "allowed_emails", "athlete_profile", "plan_versions", "plan_weeks", "sessions", "pace_profile", "hr_profile",
  "workout_logs", "daily_checkins", "plan_changes", "engine_notices", "medical_clearances", "safety_events", "push_subscriptions",
];
async function main() {
let bad = 0;
for (const t of tables) {
  const { error, count } = await db.from(t).select("*", { count: "exact" }).limit(1);
  if (error) bad++;
  console.log(t.padEnd(20), error ? `ERROR: ${error.message}` : `ok (${count} baris)`);
}
const { error } = await db.from("workout_logs").select("splits, aerobic_te, elapsed_s").limit(1);
if (error) bad++;
console.log("kolom M7".padEnd(20), error ? `BELUM: ${error.message}` : "ok");
process.exit(bad ? 1 : 0);
}
main();
