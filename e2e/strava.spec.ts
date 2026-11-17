import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";

test.describe.configure({ mode: "serial" });

const dataDir = process.env.E2E_DATA_DIR!;

/** Draft seperti hasil ingest Strava: data sensor terisi, RPE kosong. */
function seedInbox() {
  const log = {
    date: "2027-01-07", session_key: "W07-thu", distance_m: 9500, duration_s: 2820, avg_hr: 156, max_hr: 172,
    hr_source: "wrist", avg_cadence: 168, rpe: null, reps: [], time_in_zone: null, hr_drop_1min: null,
    discomfort_at_hr: { flag: false, bpm: null }, rep_incomplete: false, temp_c: null, humidity: null,
    pain: { score: 0, location: null, sharp: false }, red_flags: [], notes: null, source: "strava",
    external_id: "strava:9001", streams: null,
  };
  writeFileSync(path.join(dataDir, "strava.json"), JSON.stringify({
    connection: null,
    inbox: [{
      activity_id: 9001, name: "Tempo Kamis", start_date: "2027-01-06T22:30:00Z", status: "pending",
      created_at: "2027-01-07T00:00:00Z",
      draft: { log, reps_detected: 0, reps_expected: 2, warnings: [], device: "HUAWEI WATCH GT 4" },
    }],
  }));
}

test("webhook: validasi verify token", async ({ request }) => {
  const bad = await request.get("/api/strava/webhook?hub.mode=subscribe&hub.challenge=abc&hub.verify_token=salah");
  expect(bad.status()).toBe(403);
  const ok = await request.get("/api/strava/webhook?hub.mode=subscribe&hub.challenge=abc&hub.verify_token=e2e-verify");
  expect(await ok.json()).toEqual({ "hub.challenge": "abc" });
  // event dari atlet tak dikenal: dibalas 200 (Strava tidak retry), tidak diproses
  const evt = await request.post("/api/strava/webhook", {
    data: { object_type: "activity", object_id: 1, aspect_type: "create", owner_id: 1, subscription_id: 1, event_time: 1 },
  });
  expect(evt.status()).toBe(200);
});

test("pengaturan: tombol Connect with Strava", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("Connect with Strava")).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect with Strava" })).toHaveAttribute("href", "/api/strava/connect");
});

test("draft Strava → lengkapi RPE → jadi log & hilang dari inbox", async ({ page }) => {
  seedInbox();
  await page.goto("/log");
  await expect(page.getByText(/Dari Strava — lengkapi dulu \(1\)/)).toBeVisible();
  await page.getByRole("link", { name: /Tempo Kamis/ }).click();
  await expect(page.getByRole("heading", { name: "Tempo Kamis" })).toBeVisible();

  // tanpa RPE tidak bisa disimpan (data tidak dikarang)
  await page.getByRole("button", { name: "Simpan log" }).click();
  await expect(page.getByText("Pilih RPE.")).toBeVisible();

  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByRole("button", { name: "Simpan log" }).click();
  await expect(page.getByText("Log tersimpan")).toBeVisible();

  await page.goto("/log");
  await expect(page.getByText(/Dari Strava — lengkapi dulu/)).toHaveCount(0);
  await expect(page.getByText("strava", { exact: true })).toBeVisible();
});

test("tidak ada halaman yang melebar dari layar HP", async ({ page }) => {
  seedInbox(); // termasuk form log dengan editor rep
  for (const p of ["/", "/program", "/program/W07-thu", "/program/changes", "/log", "/log/new", "/log/strava/9001", "/coach", "/settings"]) {
    await page.goto(p);
    const { doc, vw } = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
    expect(doc, p).toBeLessThanOrEqual(vw);
  }
});
