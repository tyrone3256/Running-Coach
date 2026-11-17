import { NextResponse } from "next/server";
import { createSupabaseServer, supabaseConfigured } from "@/lib/supabase/server";

export async function POST() {
  if (supabaseConfigured()) await (await createSupabaseServer()).auth.signOut();
  return NextResponse.json({ ok: true });
}
