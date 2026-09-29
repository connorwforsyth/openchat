// The static preview's file server (067), as the source `static-preview.ts`
// writes into the sandbox and runs with `node <script> <root> <port>`. It's
// a string because it runs in the sandbox's own Node, not this process, and
// it uses Node's built-ins only, so any image with `node` can run it.
//
// What it guarantees: GET and HEAD only; a path never leaves the root, even
// through `..`, encoded slashes or a symlink; a directory serves its
// `index.html` (after a redirect to the trailing slash, so relative links
// resolve); nothing is cached, so a reload shows the latest save. A second
// copy started while one listens exits quietly, which is what makes starting
// it idempotent under a race.
//
// Kept free of backticks and `${`, since it lives in a template literal.

export const STATIC_PREVIEW_SERVER = String.raw`import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, sep } from "node:path";

const [rootArg = "/work", portArg = "0"] = process.argv.slice(2);
const root = await realpath(rootArg);

const TEXT = "; charset=utf-8";
const TYPES = {
  ".avif": "image/avif",
  ".css": "text/css" + TEXT,
  ".csv": "text/csv" + TEXT,
  ".gif": "image/gif",
  ".htm": "text/html" + TEXT,
  ".html": "text/html" + TEXT,
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript" + TEXT,
  ".json": "application/json" + TEXT,
  ".map": "application/json" + TEXT,
  ".md": "text/markdown" + TEXT,
  ".mjs": "text/javascript" + TEXT,
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain" + TEXT,
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml" + TEXT,
};

const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, {
    ...BASE_HEADERS,
    "content-type": "text/plain" + TEXT,
    ...headers,
  });
  res.end(body);
};

const inside = (path) => path === root || path.startsWith(root + sep);

/** The real file behind a request path, or null when it would leave the root. */
const resolve = async (pathname) => {
  // join normalises "..", so a path that climbs out ends up outside root.
  const target = join(root, pathname);
  if (!inside(target)) {
    return null;
  }
  // A symlink may point anywhere; follow it and check again.
  const real = await realpath(target);
  return inside(real) ? real : null;
};

const NOT_FOUND = new Set(["ENOENT", "ENOTDIR", "ENAMETOOLONG"]);

const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "Method not allowed\n", { allow: "GET, HEAD" });
      return;
    }
    const raw = req.url ?? "/";
    const queryAt = raw.indexOf("?");
    const rawPath = queryAt === -1 ? raw : raw.slice(0, queryAt);
    const query = queryAt === -1 ? "" : raw.slice(queryAt);
    let pathname;
    try {
      pathname = decodeURIComponent(rawPath);
    } catch {
      send(res, 400, "Bad request\n");
      return;
    }
    if (!pathname.startsWith("/") || pathname.includes("\0")) {
      send(res, 400, "Bad request\n");
      return;
    }
    let file = await resolve(pathname);
    if (file === null) {
      send(res, 404, "Not found\n");
      return;
    }
    let info = await stat(file);
    if (info.isDirectory()) {
      if (!rawPath.endsWith("/")) {
        // One leading slash only: "//host/" would send the browser elsewhere.
        const location = "/" + rawPath.replace(/^\/+/, "") + "/" + query;
        send(res, 301, "", { location });
        return;
      }
      file = await resolve(join(pathname, "index.html"));
      if (file === null) {
        send(res, 404, "Not found\n");
        return;
      }
      info = await stat(file);
    }
    if (!info.isFile()) {
      send(res, 404, "Not found\n");
      return;
    }
    res.writeHead(200, {
      ...BASE_HEADERS,
      "content-length": info.size,
      "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
    } else if (NOT_FOUND.has(error?.code)) {
      send(res, 404, "Not found\n");
    } else if (error?.code === "EACCES") {
      send(res, 403, "Forbidden\n");
    } else {
      send(res, 500, "Internal error\n");
    }
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    // Another copy got there first; it serves the same files.
    process.exit(0);
  }
  throw error;
});

server.listen(Number(portArg), "0.0.0.0", () => {
  console.log("static preview on port " + server.address().port + ", serving " + root);
});
`;
