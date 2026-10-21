import { brandAssetPath } from "@workspace/config/brand";
import type { MetadataRoute } from "next";

import { getPublicConfig } from "@/lib/public-config";

// Installing the app (a home-screen icon, a standalone window) takes its name
// and icons from `brand:` (D18), so this is made per request, not at build.
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const config = await getPublicConfig();
  const name = config.ok ? config.config.brand.name : undefined;
  return {
    display: "standalone",
    icons: [
      {
        purpose: "any",
        sizes: "192x192",
        src: brandAssetPath("icon-192.png"),
        type: "image/png",
      },
      {
        purpose: "any",
        sizes: "512x512",
        src: brandAssetPath("icon-512.png"),
        type: "image/png",
      },
      {
        purpose: "maskable",
        sizes: "512x512",
        src: brandAssetPath("icon-maskable-512.png"),
        type: "image/png",
      },
    ],
    name,
    short_name: name,
    start_url: "/",
  };
}
