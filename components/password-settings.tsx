"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { setPassword } from "@/app/settings/actions";

const inputCls = "h-11 w-full rounded-lg border bg-background px-3 text-base";

export function PasswordSettings() {
  const [state, action, pending] = useActionState(setPassword, null);
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
      <p className="font-medium">Password</p>
      <p className="text-muted-foreground">Atur password supaya bisa masuk tanpa membuka email. Sesi di HP ini tetap tersimpan sampai kamu menekan Keluar.</p>
      <form action={action} className="flex flex-col gap-2">
        <input name="password" type="password" autoComplete="new-password" placeholder="password baru (min. 8)" aria-label="Password baru" className={inputCls} />
        <input name="password2" type="password" autoComplete="new-password" placeholder="ulangi password" aria-label="Ulangi password" className={inputCls} />
        <Button type="submit" variant="outline" className="self-start" disabled={pending}>{pending ? "Menyimpan…" : "Simpan password"}</Button>
      </form>
      {state && <p className={state.ok ? "text-emerald-700" : "text-destructive"}>{state.msg}</p>}
    </section>
  );
}
