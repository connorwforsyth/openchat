import {
  BRAND_ASSETS,
  type BrandAsset,
  type BrandAssetName,
  type BrandFile,
  type BrandImages,
  brandFile,
  isBrandAssetName,
  madeOnce,
  PLACEHOLDER_IMAGES,
  tabIcon,
  tileMark,
} from "@workspace/config/brand";
import { ImageResponse } from "next/og";

import { getBrandFiles } from "@/lib/brand-files";

// The brand's logos and icons (packages/config/src/brand.ts), made from
// `brand:` in app.config.yaml at request time, so one build serves any brand.
// Each is made once per process; config changes apply on restart (D18).
// Logos are served as they are; the page decides how to draw them.

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
  { icon }: BrandImages,
  iconBackground: string,
  { markScale, size }: Extract<BrandAsset, { kind: "tile" }>
): Promise<BrandFile> => {
  const mark = Math.round(size * markScale);
  const { invert, src } = tileMark(icon);
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
        src={src}
        style={{
          filter: invert ? "invert(1)" : undefined,
          objectFit: "contain",
        }}
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

const make = async (
  asset: BrandAsset,
  images: BrandImages,
  iconBackground: string
): Promise<BrandFile | null> => {
  switch (asset.kind) {
    case "icon":
      return { body: tabIcon(images.icon), type: "image/svg+xml" };
    case "logo":
      return images.logo ? brandFile(images.logo[asset.theme]) : null;
    case "tile":
      return await tile(images, iconBackground, asset);
    default:
      return asset satisfies never;
  }
};

// A mark next/og can't draw (an SVG with no viewBox or size, say) would fail
// every tile; those get the placeholder until the brand is fixed.
const madeFile = madeOnce(
  async (name: BrandAssetName) => {
    const files = await getBrandFiles();
    return make(BRAND_ASSETS[name], files, files.iconBackground);
  },
  async (name, error) => {
    // The error quotes the whole mark as a data URI; its last part says why.
    const why = String(error).split(": ").at(-1);
    console.warn(
      `[brand] ${name} can't be made (${why}); using the placeholder`
    );
    const { iconBackground } = await getBrandFiles();
    return make(BRAND_ASSETS[name], PLACEHOLDER_IMAGES, iconBackground);
  }
);

export async function GET(
  _request: Request,
  { params }: RouteContext<"/brand/[asset]">
): Promise<Response> {
  const { asset } = await params;
  const found = isBrandAssetName(asset) ? await madeFile(asset) : null;
  return found
    ? new Response(found.body, {
        headers: { ...HEADERS, "Content-Type": found.type },
      })
    : new Response(null, { status: 404 });
}
