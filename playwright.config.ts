import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// E2E memakai build produksi (service worker hanya aktif di produksi) + penyimpanan lokal sementara.
const dataDir = process.env.E2E_DATA_DIR ?? mkdtempSync(path.join(tmpdir(), "rc-e2e-"));
process.env.E2E_DATA_DIR = dataDir;
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Pixel 7"],
    // pakai Edge/Chrome yang terpasang; set PW_CHANNEL=chromium bila memakai browser bawaan Playwright
    channel: process.env.PW_CHANNEL ?? "msedge",
    serviceWorkers: "allow",
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/offline`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      LOCAL_DATA_DIR: dataDir,
      ALLOW_LOCAL_STORE: "1",
      CRON_SECRET: "e2e-cron-secret",
      // kunci palsu: hanya untuk membuktikan nilainya tidak pernah sampai ke bundle client
      ANTHROPIC_API_KEY: "sk-ant-e2e-dummy-should-never-leak",
      // E2E tidak boleh memanggil Anthropic sungguhan: arahkan SDK ke port lokal yang tertutup
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      STRAVA_CLIENT_ID: "e2e-client",
      STRAVA_CLIENT_SECRET: "e2e-secret",
      STRAVA_WEBHOOK_VERIFY_TOKEN: "e2e-verify",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
  },
});
