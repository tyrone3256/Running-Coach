import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/strava/api";
import { ingestDeps, stravaCreds } from "@/lib/strava/server";
import { getStravaStore } from "@/lib/strava/store";
import { syncRecent } from "@/lib/strava/ingest";

const back = (req: NextRequest, status: string) => {
  const res = NextResponse.redirect(new URL(`/settings?strava=${status}`, req.url));
  res.cookies.delete({ name: "strava_oauth_state", path: "/api/strava" });
  return res;
};

/** Callback OAuth Strava: cek state & scope, tukar kode → token (disimpan di server saja). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(req, "denied");
  const state = sp.get("state");
  const cookie = req.cookies.get("strava_oauth_state")?.value;
  if (!state || !cookie || state !== cookie) return back(req, "bad_state");
  const scope = sp.get("scope") ?? "";
  if (!scope.split(",").some((s) => s === "activity:read_all" || s === "activity:read")) return back(req, "no_scope");
  const code = sp.get("code");
  if (!code) return back(req, "error");
  try {
    const conn = await exchangeCode(fetch, stravaCreds(), code, scope);
    await getStravaStore().saveConnection(conn);
    await syncRecent(ingestDeps(), 7).catch(() => null); // tarik seminggu terakhir sekali
    return back(req, "ok");
  } catch (e) {
    console.error("strava callback", e);
    return back(req, "error");
  }
}
