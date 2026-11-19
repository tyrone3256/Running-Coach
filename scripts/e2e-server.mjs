// Server E2E: build & start terpisah (.next-e2e) TANPA Supabase/push, walau .env.local berisi kunci asli.
// Variabel kosong tidak ditimpa .env.local oleh Next, jadi build ini selalu mode lokal.
import { spawnSync, spawn } from "node:child_process";

const port = process.argv[2] ?? "3100";
const env = {
  ...process.env,
  NEXT_DIST_DIR: ".next-e2e",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  OWNER_EMAIL: "",
  // khusus lokal: simpan ke .local-data (di produksi sungguhan diblokir)
  ALLOW_LOCAL_STORE: "1",
  LOCAL_DATA_DIR: process.env.LOCAL_DATA_DIR ?? ".local-data-preview",
};
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const b = spawnSync(npx, ["next", "build", "--turbopack"], { env, stdio: "inherit", shell: process.platform === "win32" });
if (b.status !== 0) process.exit(b.status ?? 1);
const s = spawn(npx, ["next", "start", "-p", port], { env, stdio: "inherit", shell: process.platform === "win32" });
s.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => s.kill(sig));
