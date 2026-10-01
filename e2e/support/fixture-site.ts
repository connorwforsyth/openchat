import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { crc32, deflateSync } from "node:zlib";

// A tiny web site for the link-preview spec (101), on loopback: a SearXNG
// stand-in (`/search?format=json`) whose results point at its own pages,
// and those pages with OG tags, a favicon and a card image. The app's
// `web_search` tool finds them, and its link-preview fetcher reads them,
// which it may only because serve.ts lists this origin in the TEST-ONLY
// `LINK_PREVIEW_TEST_ALLOW_ORIGINS`. Nothing here leaves the machine.

/** A truecolor PNG drawn by `pixel`, so the fixture needs no binary files. */
const png = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number]
): Buffer => {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) {
      rows.push(...pixel(x, y));
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const HERO = png(320, 180, (x, y) => [
  Math.round(30 + (60 * y) / 180),
  Math.round(90 + (80 * x) / 320),
  Math.round(150 + 90 * (1 - y / 180)),
]);

const ICON = png(32, 32, (x, y) =>
  (x - 16) ** 2 + (y - 16) ** 2 < 196 ? [20, 110, 200] : [255, 255, 255]
);

export const FIXTURE_ARTICLE = {
  description:
    "A study of 300 rivers finds water temperatures rising faster than the air above them.",
  siteName: "Fixture News",
  title: "Rivers are getting warmer",
} as const;

const article = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Rivers | Fixture News</title>
<meta property="og:title" content="${FIXTURE_ARTICLE.title}">
<meta property="og:description" content="${FIXTURE_ARTICLE.description}">
<meta property="og:site_name" content="${FIXTURE_ARTICLE.siteName}">
<meta property="og:image" content="/hero.png">
<meta property="og:image:alt" content="A river at dawn">
<link rel="icon" href="/icon.png" sizes="32x32" type="image/png">
</head><body><h1>Rivers</h1></body></html>`;

const plain = `<!doctype html>
<html lang="en"><head><title>Plain notes</title>
<meta name="description" content="A page with no image.">
</head><body></body></html>`;

/** Where serve.ts records the site's origin for the specs (gitignored). */
const ORIGIN_FILE = new URL("../.auth/fixture-site.json", import.meta.url);

export const recordFixtureOrigin = async (origin: string) => {
  await mkdir(new URL(".", ORIGIN_FILE), { recursive: true });
  await writeFile(ORIGIN_FILE, JSON.stringify({ origin }));
};

/** The running fixture site's origin, e.g. `http://127.0.0.1:53211`. */
export const fixtureOrigin = async (): Promise<string> => {
  const { origin } = JSON.parse(await readFile(ORIGIN_FILE, "utf8")) as {
    origin: string;
  };
  return origin;
};

export interface FixtureSite {
  readonly close: () => Promise<void>;
  readonly origin: string;
}

const send = (
  response: ServerResponse,
  type: string,
  body: string | Buffer
) => {
  response.writeHead(200, { "content-type": type });
  response.end(body);
};

export const startFixtureSite = async (): Promise<FixtureSite> => {
  let origin = "";
  const handle = (request: IncomingMessage, response: ServerResponse) => {
    const { pathname } = new URL(request.url ?? "/", "http://fixture");
    switch (pathname) {
      case "/search":
        send(
          response,
          "application/json",
          JSON.stringify({
            results: [
              {
                content: FIXTURE_ARTICLE.description,
                title: FIXTURE_ARTICLE.title,
                url: `${origin}/rivers`,
              },
              {
                content: "A page with no image.",
                title: "Plain notes",
                url: `${origin}/notes`,
              },
            ],
          })
        );
        return;
      case "/rivers":
        send(response, "text/html; charset=utf-8", article);
        return;
      case "/notes":
        send(response, "text/html; charset=utf-8", plain);
        return;
      case "/hero.png":
        send(response, "image/png", HERO);
        return;
      case "/icon.png":
        send(response, "image/png", ICON);
        return;
      default:
        response.writeHead(404).end();
    }
  };
  const server: Server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    origin,
  };
};
