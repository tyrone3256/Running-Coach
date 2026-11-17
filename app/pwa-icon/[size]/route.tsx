import { ImageResponse } from "next/og";

const SIZES = new Set([180, 192, 512]);

/** Ikon PWA digambar di server (tanpa file biner di repo). */
export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response("ukuran tidak didukung", { status: 404 });
  const maskable = new URL(req.url).searchParams.has("maskable");
  const pad = maskable ? 0.2 : 0.08; // maskable: konten di safe zone 80%
  const inner = Math.round(size * (1 - pad * 2));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a" }}>
        <div style={{
          width: inner, height: inner, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          borderRadius: maskable ? 0 : inner * 0.22, background: "#16a34a", color: "white",
        }}>
          <div style={{ fontSize: inner * 0.36, fontWeight: 800, lineHeight: 1 }}>HM</div>
          <div style={{ fontSize: inner * 0.17, fontWeight: 600, marginTop: inner * 0.04 }}>1:45</div>
        </div>
      </div>
    ),
    { width: size, height: size, headers: { "cache-control": "public, max-age=604800, immutable" } },
  );
}
