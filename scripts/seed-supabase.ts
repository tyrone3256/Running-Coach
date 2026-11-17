/**
 * Seed Supabase dari seed/plan.json.
 *   npm run seed:supabase            # gagal bila plan versi 1 sudah ada
 *   npm run seed:supabase -- --reset # hapus plan/profil milik owner lalu seed ulang
 *
 * Env (di .env.local, JANGAN di-commit):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_EMAIL
 * Service role key hanya dipakai di script ini (lokal), tidak pernah di app/client.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { PlanSeed } from "../lib/engine/types";
import { planToRows } from "../lib/data/seed-rows";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.OWNER_EMAIL;
if (!url || !key || !email) {
  console.error("Butuh NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_EMAIL");
  process.exit(1);
}
const reset = process.argv.includes("--reset");
const db = createClient(url, key, { auth: { persistSession: false } });

function check<T>(res: { data: T; error: unknown }, what: string): T {
  if (res.error) throw new Error(`${what}: ${JSON.stringify(res.error)}`);
  return res.data;
}

async function ownerId(): Promise<string> {
  check(await db.from("allowed_emails").upsert({ email: email!.toLowerCase() }), "allowlist");
  for (let page = 1; page < 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === email!.toLowerCase());
    if (u) return u.id;
    if (data.users.length < 200) break;
  }
  const { data, error } = await db.auth.admin.createUser({ email: email!, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  const plan = JSON.parse(readFileSync("seed/plan.json", "utf-8")) as PlanSeed;
  const uid = await ownerId();
  const existing = check(await db.from("plan_versions").select("id").eq("user_id", uid), "cek plan");
  if (existing?.length && !reset) {
    console.error("Plan sudah ada. Pakai --reset untuk seed ulang (menghapus plan, log tidak dihapus).");
    process.exit(1);
  }
  if (reset) {
    for (const t of ["plan_versions", "pace_profile", "hr_profile", "athlete_profile"]) {
      check(await db.from(t).delete().eq("user_id", uid), `hapus ${t}`);
    }
  }
  const rows = planToRows(plan, uid, randomUUID());
  check(await db.from("athlete_profile").upsert(rows.athlete_profile), "athlete_profile");
  check(await db.from("pace_profile").insert(rows.pace_profile), "pace_profile");
  check(await db.from("hr_profile").insert(rows.hr_profile), "hr_profile");
  check(await db.from("plan_versions").insert(rows.plan_version), "plan_versions");
  check(await db.from("plan_weeks").insert(rows.plan_weeks), "plan_weeks");
  check(await db.from("sessions").insert(rows.sessions), "sessions");
  console.log(`OK: ${rows.sessions.length} sesi, ${rows.plan_weeks.length} minggu untuk ${email}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
