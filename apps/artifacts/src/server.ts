import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { appOriginsFrom, responseHeaders } from "./headers";

// Serves the built runtime (dist/public) with its security headers. A static
// file server rather than a framework: the page is the whole app. Runs under
// bun in development (`--watch` also rebuilds on change) and under node from
// the bundle in dist/server.js, which is why the path below works from both.

const envSchema = z.object({
  ARTIFACTS_APP_ORIGINS: z.string().optional(),
  // Loopback unless told otherwise; the image listens on 0.0.0.0.
  ARTIFACTS_HOST: z.string().min(1).catch("127.0.0.1"),
  ARTIFACTS_PORT: z.coerce.number().int().min(1).max(65_535).catch(3910),
});

const env = envSchema.parse(process.env);
const appOrigins = appOriginsFrom(env.ARTIFACTS_APP_ORIGINS);
const publicDir = fileURLToPath(new URL("../dist/public/", import.meta.url));

/** The file a request path names, or `null` if it escapes `publicDir`. */
const fileFor = (pathname: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = resolve(
    publicDir,
    `.${decoded.endsWith("/") ? `${decoded}index.html` : decoded}`
  );
  return file.startsWith(publicDir.endsWith(sep) ? publicDir : publicDir + sep)
    ? file
    : null;
};

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const { pathname } = new URL(request.url ?? "/", "http://runtime");
  const file = fileFor(pathname);
  const body = file ? await readFile(file).catch(() => null) : null;
  if (!(file && body)) {
    response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  response.writeHead(200, responseHeaders(file, appOrigins));
  response.end(request.method === "HEAD" ? undefined : body);
});

if (process.argv.includes("--watch")) {
  // Development: rebuild the page whenever its source changes, and stop
  // the watcher with the server.
  const watcher = spawn("bun", ["run", "build:public", "--watch"], {
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      watcher.kill(signal);
      process.exit(0);
    });
  }
}

server.listen(env.ARTIFACTS_PORT, env.ARTIFACTS_HOST, () => {
  console.log(
    `artifact runtime on http://${env.ARTIFACTS_HOST}:${env.ARTIFACTS_PORT}, embeddable by ${appOrigins.join(" ")}`
  );
});
