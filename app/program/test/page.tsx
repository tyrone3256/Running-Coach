import Link from "next/link";
import { TestForm } from "@/components/test-form";
import { todayIso } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default function TestPage() {
  return (
    <main className="flex flex-col gap-4">
      <nav className="text-sm"><Link href="/program/changes" className="text-muted-foreground hover:underline">← Perubahan program</Link></nav>
      <h1 className="text-2xl font-semibold">Hasil tes / time trial</h1>
      <p className="text-sm text-muted-foreground">
        R5: LTHR = avg HR 20 menit terakhir; jarak/waktu → VDOT → pace M/H/T/N/E dihitung ulang relatif terhadap kalibrasi program.
      </p>
      <TestForm defaultDate={todayIso()} />
    </main>
  );
}
