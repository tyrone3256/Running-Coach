import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("Hari ini, navigasi bawah, dan halaman utama tampil", async ({ page }) => {
  await page.goto("/?date=2027-01-07");
  await expect(page.getByRole("heading", { name: /Hari ini/ })).toBeVisible();
  await expect(page.getByText("Tempo / threshold").first()).toBeVisible();
  for (const [name, heading] of [["Program", /Program/], ["Log", /Log/], ["Coach", /Coach/]] as const) {
    await page.getByRole("navigation").getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
});

test("manifest & ikon PWA valid", async ({ request }) => {
  const m = await (await request.get("/manifest.webmanifest")).json();
  expect(m.display).toBe("standalone");
  expect(m.start_url).toBe("/");
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  expect(m.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
});

test("service worker aktif; halaman yang pernah dibuka tersedia offline", async ({ page, context }) => {
  await page.goto("/program");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // sekarang dikontrol SW → salinan halaman tersimpan
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.goto("/program");
  await context.setOffline(true);
  await page.goto("/program");
  await expect(page.getByRole("heading", { level: 1, name: /Program/ })).toBeVisible();
  await page.goto("/program/W20-thu"); // belum pernah dibuka
  await expect(page.getByRole("heading", { name: "Sedang offline" })).toBeVisible();
  await context.setOffline(false);
});

test("secret server tidak pernah ada di JS client", async ({ page, request }) => {
  const scripts = new Set<string>();
  page.on("response", (r) => { if (r.url().endsWith(".js")) scripts.add(r.url()); });
  for (const p of ["/", "/coach", "/settings", "/log/new", "/program/changes"]) await page.goto(p);
  expect(scripts.size).toBeGreaterThan(3);
  for (const url of scripts) {
    const body = await (await request.get(url)).text();
    expect(body, url).not.toContain("e2e-cron-secret");
    expect(body, url).not.toContain("e2e-vapid-private");
  }
});

test("Coach: lapor 'nyeri dada' → STOP, program ditahan, lalu dibuka setelah 'sudah diperiksa'", async ({ page }) => {
  await page.goto("/coach");
  await page.getByText("Lapor gejala bahaya").click();
  await page.getByLabel("Nyeri / tekanan di dada").check();
  await page.getByRole("button", { name: "Laporkan gejala" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "STOP latihan" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("EKG");

  await page.goto("/?date=2027-01-07");
  await expect(page.getByText("STOP — program ditahan")).toBeVisible();
  await expect(page.getByText("Tempo / threshold")).toHaveCount(0);

  await page.getByRole("button", { name: "Sudah diperiksa dokter?" }).click();
  await page.getByRole("button", { name: "Saya sudah diperiksa dokter" }).click();
  await expect(page.getByText("STOP — program ditahan")).toHaveCount(0);
});

test("cron: tanpa secret ditolak; dengan secret menjalankan engine harian", async ({ request }) => {
  expect((await request.get("/api/cron/morning")).status()).toBe(401);
  expect((await request.get("/api/cron/morning", { headers: { authorization: "Bearer salah" } })).status()).toBe(401);
  const ok = await request.get("/api/cron/morning", { headers: { authorization: "Bearer e2e-cron-secret" } });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.job).toBe("morning");
  expect(body.engine).toBeTruthy();
});

test("pengaturan: status & tombol notifikasi", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Pengaturan" })).toBeVisible();
  await expect(page.getByText("Notifikasi", { exact: true })).toBeVisible();
  await expect(page.getByText(/Zona HR \(LTHR 170\)/)).toBeVisible();
  await expect(page.getByText("Connect with Strava")).toHaveCount(0); // Strava nonaktif
});
