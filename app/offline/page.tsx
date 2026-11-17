export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="flex flex-col gap-3 pt-10 text-center">
      <h1 className="text-2xl font-semibold">Sedang offline</h1>
      <p className="text-sm text-muted-foreground">
        Halaman ini belum tersimpan di HP. Halaman yang pernah dibuka (Hari ini, Program) tetap bisa dilihat offline,
        dan log/check-in yang kamu isi dikirim otomatis saat online lagi.
      </p>
    </main>
  );
}
