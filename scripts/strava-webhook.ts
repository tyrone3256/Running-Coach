// Kelola subscription webhook Strava (satu per app). Jalankan dari laptop setelah deploy:
//   npx tsx --env-file=.env.local scripts/strava-webhook.ts create https://<domain>/api/strava/webhook
//   npx tsx --env-file=.env.local scripts/strava-webhook.ts view
//   npx tsx --env-file=.env.local scripts/strava-webhook.ts delete <id>
// Butuh STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_WEBHOOK_VERIFY_TOKEN (sama dengan di Vercel).
const BASE = "https://www.strava.com/api/v3/push_subscriptions";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} belum diisi`);
  return v;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const client_id = env("STRAVA_CLIENT_ID");
  const client_secret = env("STRAVA_CLIENT_SECRET");
  const q = new URLSearchParams({ client_id, client_secret });
  let res: Response;
  if (cmd === "create") {
    if (!arg?.startsWith("https://")) throw new Error("Beri callback URL https://<domain>/api/strava/webhook");
    // Strava memanggil GET validasi ke callback saat ini juga → app harus sudah ter-deploy dengan verify token yang sama
    res = await fetch(BASE, {
      method: "POST",
      body: new URLSearchParams({ client_id, client_secret, callback_url: arg, verify_token: env("STRAVA_WEBHOOK_VERIFY_TOKEN") }),
    });
  } else if (cmd === "view") {
    res = await fetch(`${BASE}?${q}`);
  } else if (cmd === "delete" && arg) {
    res = await fetch(`${BASE}/${encodeURIComponent(arg)}?${q}`, { method: "DELETE" });
  } else {
    console.log("Pakai: create <callback_url> | view | delete <id>");
    process.exit(1);
  }
  const text = await res.text();
  console.log(res.status, text || "(kosong)");
  if (cmd === "create" && res.ok) {
    console.log("\nIsi STRAVA_SUBSCRIPTION_ID di Vercel dengan id di atas, lalu redeploy.");
  }
  if (!res.ok) process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
