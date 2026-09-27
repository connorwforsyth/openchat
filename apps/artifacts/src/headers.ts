import { parseOrigin } from "@workspace/chat-ui/artifacts/runtime-protocol";

// The headers on everything the runtime serves (D24). The page runs code a
// model wrote, so it gets no network at all: its own chunks are the only
// thing it can load, and `sandbox` forces an opaque origin even if someone
// opens it outside our iframe, so it never has cookies or storage to read.

/** Who may embed the runtime when `ARTIFACTS_APP_ORIGINS` is unset: local dev. */
export const DEV_APP_ORIGINS: readonly string[] = [
  "http://localhost:*",
  "http://127.0.0.1:*",
];

/**
 * The app origins allowed to frame the runtime, from a comma-separated list.
 * Entries that aren't origins are dropped; none left means the dev default.
 */
export const appOriginsFrom = (
  value: string | undefined
): readonly string[] => {
  const origins = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const parsed = parseOrigin(entry);
      return parsed.ok ? [parsed.value] : [];
    });
  return origins.length > 0 ? origins : DEV_APP_ORIGINS;
};

export const contentSecurityPolicy = (appOrigins: readonly string[]): string =>
  [
    "default-src 'none'",
    // The runtime's own chunks, and the artifact's code: React artifacts are
    // compiled in the frame and run with `new Function`, and HTML artifacts
    // carry inline scripts. The sandbox, not the CSP, contains that code; the
    // CSP's job is that nothing gets in or out over the network.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    // Artifacts and Mermaid's SVGs style themselves inline.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    // HTML artifacts render in a nested `srcdoc` frame, which inherits this.
    "frame-src 'self'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${appOrigins.join(" ")}`,
    "sandbox allow-scripts",
  ].join("; ");

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export const contentTypeFor = (path: string): string => {
  const extension = path.slice(path.lastIndexOf("."));
  return contentTypes[extension] ?? "application/octet-stream";
};

export const responseHeaders = (
  path: string,
  appOrigins: readonly string[]
): Readonly<Record<string, string>> => ({
  // The frame's origin is opaque, so even its own module chunks are
  // cross-origin fetches that need CORS. Nothing here is private.
  "Access-Control-Allow-Origin": "*",
  // Chunk names carry a content hash; the page itself must revalidate.
  "Cache-Control": path.endsWith(".html")
    ? "no-cache"
    : "public, max-age=31536000, immutable",
  "Content-Security-Policy": contentSecurityPolicy(appOrigins),
  "Content-Type": contentTypeFor(path),
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});
