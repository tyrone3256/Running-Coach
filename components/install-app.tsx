"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallApp() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
      <p className="font-medium">Pasang di HP</p>
      {installed ? (
        <p className="text-muted-foreground">Sudah terpasang sebagai app.</p>
      ) : (
        <>
          <p className="text-muted-foreground">
            Android (Chrome): menu ⋮ → <b>Instal aplikasi</b> / <b>Tambahkan ke layar utama</b>. Setelah terpasang, app buka layar penuh,
            halaman yang pernah dibuka bisa dilihat offline, dan notifikasi lebih andal.
          </p>
          {evt && (
            <Button className="self-start" onClick={async () => { await evt.prompt(); await evt.userChoice; setEvt(null); }}>
              Instal sekarang
            </Button>
          )}
        </>
      )}
    </section>
  );
}
