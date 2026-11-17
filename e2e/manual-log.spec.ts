import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("log manual ala Huawei Health/Strava → feedback coach berbasis aturan", async ({ page }) => {
  await page.goto("/log/new?date=2027-01-06"); // W07 Rabu: easy + strides
  await page.getByLabel("Jarak (km)").fill("7");
  await page.getByLabel("Waktu bergerak").fill("43:10");
  await page.getByLabel("HR rata-rata").fill("163");
  await page.getByLabel("HR maks").fill("171");
  await page.getByLabel("Kadens").fill("84"); // tampilan per-kaki → dikali 2
  await expect(page.getByText("= 168 langkah/menit")).toBeVisible();
  await page.getByRole("button", { name: "6", exact: true }).click();

  // form lengkap: bagian detail sudah terbuka
  await page.getByLabel("Waktu total").fill("45:00");
  await page.getByLabel("Elevasi naik (m)").fill("12");
  await page.getByLabel("Kalori (kkal)").fill("480");
  await page.getByLabel("Aerobic TE (0–5)", { exact: true }).fill("3,4");
  await page.getByLabel("Menit Z2").fill("20");
  await page.getByLabel("Menit Z3").fill("18");
  await page.getByRole("button", { name: /Isi split \(7 km\)/ }).click();
  const paces = ["6:05", "6:08", "6:10", "6:10", "6:12", "6:11", "6:15"];
  const hrs = ["150", "155", "160", "163", "166", "168", "170"];
  for (let i = 0; i < 7; i++) {
    await page.getByLabel(`Pace km ${i + 1}`).fill(paces[i]);
    await page.getByLabel(`HR km ${i + 1}`).fill(hrs[i]);
  }
  await page.getByRole("button", { name: "Simpan log" }).click();
  await expect(page.getByText("Log tersimpan")).toBeVisible();

  await page.getByRole("link", { name: /Lihat feedback coach/ }).click();
  await expect(page.getByText("Feedback coach")).toBeVisible();
  await expect(page.getByText(/HR rata-rata 163 di atas batas Z2/)).toBeVisible();
  await expect(page.getByText(/Cardiac drift/)).toBeVisible();
  await expect(page.getByText("168 langkah/menit")).toBeVisible();
  await expect(page.getByText("480 kkal")).toBeVisible();
  await expect(page.getByText("Split per km (7)")).toBeVisible();
});

test("tanpa RPE tidak bisa disimpan (tidak mengarang data)", async ({ page }) => {
  await page.goto("/log/new?date=2027-01-06");
  await page.getByLabel("Jarak (km)").fill("7");
  await page.getByLabel("Waktu bergerak").fill("43:10");
  await page.getByRole("button", { name: "Simpan log" }).click();
  await expect(page.getByText("Pilih RPE.")).toBeVisible();
});

test("halaman Coach: sesi, feedback terakhir, panduan", async ({ page }) => {
  await page.goto("/coach");
  await expect(page.getByRole("heading", { name: "Coach" })).toBeVisible();
  await expect(page.getByText("Feedback lari terakhir")).toBeVisible();
  await page.getByText("HR 170 terasa berat — normal atau bahaya?").click();
  await expect(page.getByText(/BAHAYA — berhenti/)).toBeVisible();
});

test("tidak ada halaman yang melebar dari layar HP", async ({ page }) => {
  for (const p of ["/", "/program", "/program/W07-thu", "/program/changes", "/log", "/log/new?date=2027-01-07", "/coach", "/settings"]) {
    await page.goto(p);
    if (p.startsWith("/log/new")) await page.getByRole("button", { name: /Isi split/ }).click(); // form terlebar
    const { doc, vw } = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
    expect(doc, p).toBeLessThanOrEqual(vw);
  }
});
