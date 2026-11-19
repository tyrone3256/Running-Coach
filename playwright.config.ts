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
    command: `node scripts/e2e-server.mjs ${PORT}`,
    url: `http://localhost:${PORT}/offline`,
    reuseExistingServer: false,
    timeout: 240_000, // termasuk build terpisah
    env: {
      LOCAL_DATA_DIR: dataDir,
      ALLOW_LOCAL_STORE: "1",
      CRON_SECRET: "e2e-cron-secret",
      // nilai palsu: membuktikan secret server tidak pernah sampai ke bundle client
      VAPID_PRIVATE_KEY: "e2e-vapid-private",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
  },
});
