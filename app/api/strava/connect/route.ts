import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { authorizeUrl } from "@/lib/strava/api";
import { stravaConfigured } from "@/lib/strava/server";

/** Mulai OAuth Strava: state acak di cookie httpOnly (anti-CSRF), lalu redirect ke Strava. */
export async function GET(req: NextRequest) {
  if (!stravaConfigured()) return NextResponse.redirect(new URL("/settings?strava=not_configured", req.url));
  const state = randomBytes(16).toString("hex");
  const redirectUri = new URL("/api/strava/callback", req.nextUrl.origin).toString();
  const res = NextResponse.redirect(authorizeUrl(process.env.STRAVA_CLIENT_ID!, redirectUri, state));
  res.cookies.set("strava_oauth_state", state, {
    httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/strava", maxAge: 600,
  });
  return res;
}
