import type { BuiltSite } from "@workspace/artifacts-kit/kinds/site/build";
import {
  type FrameMessage,
  parentOriginFrom,
  type RenderRequest,
  RUNTIME_CHANNEL,
  type RuntimeError,
  readHostMessage,
} from "@workspace/chat-ui/artifacts/runtime-protocol";

import { runtimeError } from "./errors";
import { SITE_ASSETS } from "./site-assets";
import {
  buildPreview,
  navigationTarget,
  PREVIEW_START,
  pageError,
} from "./site-preview";
import { SITE_RUNTIME_META, siteTsxPorts } from "./site-tsx";
import { tailwindCompiler } from "./tailwind";

// The site preview page (125), `site.html`: the runtime protocol's other
// end, like `main.ts`, for sites only. It says `ready`, builds whatever site
// the panel posts and shows its home page; links between the site's pages
// show the page they point at. It never reports a height, so the panel's
// frame keeps the size of the view, as a browser window would.

const root = document.getElementById("root");
const parent = parentOriginFrom(window.location.search);
const compile = tailwindCompiler(SITE_ASSETS.tailwindCss);
// Where the site runtime is, as the server wrote it into this page (163).
// Absolute, since a `srcdoc` page resolves nothing against this one's URL
// on its own. Without it, TSX pages fail to build and say so.
const runtimePath = document
  .querySelector(`meta[name="${SITE_RUNTIME_META}"]`)
  ?.getAttribute("content");
const tsx = runtimePath
  ? siteTsxPorts(new URL(runtimePath, window.location.href).href)
  : undefined;

const start = (container: HTMLElement, parentOrigin: string) => {
  const post = (message: FrameMessage) =>
    window.parent.postMessage(message, parentOrigin);
  let current: RenderRequest | null = null;
  let site: BuiltSite | null = null;
  let frame: HTMLIFrameElement | null = null;

  const fail = (request: RenderRequest, error: RuntimeError) => {
    if (current === request) {
      post({ channel: RUNTIME_CHANNEL, error, id: request.id, type: "error" });
    }
  };

  const show = (request: RenderRequest, built: BuiltSite, page: string) => {
    const next = document.createElement("iframe");
    // The page's own scripts run; it gets no origin, as this page has none.
    next.setAttribute("sandbox", "allow-scripts");
    next.setAttribute("referrerpolicy", "no-referrer");
    next.title = request.title;
    next.srcdoc = built.files[page] ?? "";
    next.addEventListener(
      "load",
      () => {
        if (current === request) {
          post({ channel: RUNTIME_CHANNEL, id: request.id, type: "rendered" });
        }
      },
      { once: true }
    );
    frame = next;
    container.replaceChildren(next);
  };

  const render = async (request: RenderRequest) => {
    current = request;
    document.documentElement.style.colorScheme = request.theme;
    document.title = request.title;
    if (request.kind !== "site") {
      fail(request, runtimeError("render", "This page shows sites only."));
      return;
    }
    const built = await buildPreview(request.code, {
      compile,
      themeCss: SITE_ASSETS.themeCss,
      tsx,
    });
    if (current !== request) {
      return;
    }
    if (!built.ok) {
      site = null;
      container.replaceChildren();
      fail(request, built.error);
      return;
    }
    site = built.value;
    show(request, built.value, PREVIEW_START);
  };

  window.addEventListener("message", (event) => {
    // A previewed page following a link to another of the site's pages,
    // or a TSX page that failed to render.
    if (frame && event.source === frame.contentWindow) {
      const error = pageError(event.data);
      if (error && current) {
        fail(current, error);
        return;
      }
      const page = site ? navigationTarget(event.data, site) : null;
      if (page && site && current) {
        show(current, site, page);
      }
      return;
    }
    const message = readHostMessage(event, {
      origin: parentOrigin,
      source: window.parent,
    });
    if (message.ok) {
      render(message.value).catch((error: unknown) => {
        if (current) {
          fail(current, runtimeError("render", error));
        }
      });
    }
  });

  post({ channel: RUNTIME_CHANNEL, type: "ready" });
};

if (root && parent.ok) {
  start(root, parent.value);
} else {
  console.error("The site preview needs ?parent=<app origin>.");
}
