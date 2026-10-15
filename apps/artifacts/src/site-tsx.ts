import type {
  CompileTsx,
  SiteTsxPorts,
} from "@workspace/artifacts-kit/kinds/site/build";
import { SITE_UI_CANDIDATES } from "@workspace/site-ui/candidates";
import { transform } from "sucrase";

// Building TSX pages (163), as the Site kind's ports: Sucrase compiles a
// page to CommonJS (types stripped, JSX on React's automatic runtime, ES
// imports as `require`), here and in the preview page alike. Compiling is
// all that happens to model code outside a visitor's browser.

export const compileSitePage: CompileTsx = (source, path) =>
  transform(source, {
    filePath: path,
    jsxRuntime: "automatic",
    production: true,
    transforms: ["typescript", "jsx", "imports"],
  }).code;

/** The ports, given where the site runtime module is served from. */
export const siteTsxPorts = (runtimeUrl: string): SiteTsxPorts => ({
  candidates: SITE_UI_CANDIDATES,
  compile: compileSitePage,
  runtimeUrl,
});

/** The `<meta>` the server writes into `site.html` to say where the runtime is. */
export const SITE_RUNTIME_META = "site-runtime";
