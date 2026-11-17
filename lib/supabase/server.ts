import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** Supabase aktif hanya bila env diisi; tanpa env app jalan dari seed/plan.json (mode lokal). */
export function supabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// ------------------------------------------------------------------ mode "owner" untuk cron
// Cron tidak punya cookie login. Di dalam runAsOwner(), store memakai service-role client dan
// user id pemilik (OWNER_EMAIL). App satu pengguna + allowlist → semua baris milik pemilik.
const ownerCtx = new AsyncLocalStorage<{ userId: string; client: SupabaseClient }>();

function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY belum diisi (dibutuhkan cron)");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function runAsOwner<T>(fn: () => Promise<T>): Promise<T> {
  const email = process.env.OWNER_EMAIL?.toLowerCase();
  if (!email) throw new Error("OWNER_EMAIL belum diisi");
  const client = serviceClient();
  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 50 });
  if (error) throw error;
  const user = data.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) throw new Error("Akun pemilik belum ada (login sekali dulu)");
  return ownerCtx.run({ userId: user.id, client }, fn);
}

export async function createSupabaseServer(): Promise<SupabaseClient> {
  const owner = ownerCtx.getStore();
  if (owner) return owner.client;
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // dipanggil dari Server Component: middleware yang me-refresh cookie
          }
        },
      },
    },
  ) as unknown as SupabaseClient;
}

/** User id aktif: pemilik (mode cron) atau user dari sesi login. */
export async function currentUserId(): Promise<string> {
  const owner = ownerCtx.getStore();
  if (owner) return owner.userId;
  const { data } = await (await createSupabaseServer()).auth.getUser();
  if (!data.user) throw new Error("Belum login");
  return data.user.id;
}
