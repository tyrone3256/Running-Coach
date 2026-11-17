"use client";
import { Button } from "@/components/ui/button";

/** Keluar: hapus cache halaman di service worker (data pribadi) lalu akhiri sesi. */
export function SignOutButton() {
  async function signOut() {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.active?.postMessage("clear-pages");
    localStorage.removeItem("coach-chat-v1");
    await fetch("/auth/signout", { method: "POST" });
    window.location.href = "/login";
  }
  return <Button variant="outline" className="self-start" onClick={signOut}>Keluar</Button>;
}
