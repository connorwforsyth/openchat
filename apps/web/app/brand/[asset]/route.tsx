import {
  type BrandAsset,
  type BrandFile,
  brandAssetOf,
  logoLayer,
  tabIcon,
  tileMark,
} from "@workspace/config/brand";
import { ImageResponse } from "next/og";

import { type BrandFiles, getBrandFiles } from "@/lib/brand-files";

// The brand's logo layers and icons (packages/config/src/brand.ts), made from
// `brand:` in app.config.yaml at request time, so one build serves any brand.
// Each is made once per process; config changes apply on restart (D18).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  // Browsers may keep an icon an hour; a restart with a new brand shows soon.
  "Cache-Control": "public, max-age=3600",
  // An SVG opened on its own is a document on our origin: no scripts in it.
  "Content-Security-Policy":
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
  "X-Content-Type-Options": "nosniff",
};

const tile = async (
  { icon, iconBackground }: BrandFiles,
  { markScale, size }: Extract<BrandAsset, { kind: "tile" }>
): Promise<BrandFile> => {
  const mark = Math.round(size * markScale);
  const image = new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: iconBackground,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: satori draws plain elements, not next/image */}
      <img
        alt=""
        height={mark}
        src={tileMark(icon)}
        style={{ objectFit: "contain" }}
        width={mark}
      />
    </div>,
    { height: size, width: size }
  );
  return {
    body: new Uint8Array(await image.arrayBuffer()),
    type: "image/png",
  };
};

const make = async (asset: BrandAsset): Promise<BrandFile | null> => {
  const files = await getBrandFiles();
  switch (asset.kind) {
    case "icon":
      return { body: tabIcon(files.icon), type: "image/svg+xml" };
    case "logo":
      return files.logo
        ? logoLayer(files.logo[asset.theme], asset.layer)
        : null;
    case "tile":
      return await tile(files, asset);
    default:
      return asset satisfies never;
  }
};

const made = new Map<string, Promise<BrandFile | null>>();

export async function GET(
  _request: Request,
  { params }: RouteContext<"/brand/[asset]">
): Promise<Response> {
  const { asset: name } = await params;
  const asset = brandAssetOf(name);
  if (!asset) {
    return new Response(null, { status: 404 });
  }
  let file = made.get(name);
  if (!file) {
    file = make(asset);
    made.set(name, file);
  }
  const found = await file;
  return found
    ? new Response(found.body, {
        headers: { ...HEADERS, "Content-Type": found.type },
      })
    : new Response(null, { status: 404 });
}
