// Isi .env.local lewat tanya-jawab di terminal (nilai tidak ditampilkan ke mana pun selain file ini).
//   node scripts/setup-env.mjs
// Kolom yang sudah terisi dilewati; tekan Enter untuk mempertahankan nilai lama.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const FILE = ".env.local";
const FIELDS = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", ask: "Supabase Project URL (Project Settings → API / Data API)", check: (v) => /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v) || "harus seperti https://xxxx.supabase.co" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", ask: "Supabase anon / publishable key", check: (v) => v.length > 30 || "terlalu pendek — salin seluruh kunci" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", ask: "Supabase service_role / secret key (RAHASIA)", check: (v) => v.length > 30 || "terlalu pendek — salin seluruh kunci" },
  { key: "OWNER_EMAIL", ask: "Email untuk login ke app", check: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || "format email tidak valid" },
];

const text = existsSync(FILE) ? readFileSync(FILE, "utf-8") : "";
const get = (k) => (text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim();
const rl = createInterface({ input: stdin, output: stdout });

const values = {};
for (const f of FIELDS) {
  const cur = get(f.key);
  for (;;) {
    const a = (await rl.question(`${f.ask}${cur ? " [sudah terisi, Enter = tetap]" : ""}:\n> `)).trim().replace(/^["']|["']$/g, "");
    const v = a || cur;
    const ok = v ? f.check(v) : "wajib diisi";
    if (ok === true) { values[f.key] = v; break; }
    console.log(`  ✗ ${ok}`);
  }
}
rl.close();
values.VAPID_SUBJECT = `mailto:${values.OWNER_EMAIL}`;

let out = text;
for (const [k, v] of Object.entries(values)) {
  out = new RegExp(`^${k}=.*$`, "m").test(out) ? out.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${out.trimEnd()}\n${k}=${v}\n`;
}
writeFileSync(FILE, out, "utf-8");
console.log(`\n✓ ${FILE} tersimpan (${Object.keys(values).length} kolom). Kembali ke Claude dan bilang "sudah".`);
