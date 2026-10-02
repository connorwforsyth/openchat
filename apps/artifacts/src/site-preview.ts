import {
  type BuiltSite,
  buildSite,
  type CompileTailwind,
  SITE_PREVIEW_CHANNEL,
} from "@workspace/artifacts-kit/kinds/site/build";
import {
  SITE_ENTRY,
  siteContentSchema,
} from "@workspace/artifacts-kit/kinds/site/content";
import type { RuntimeError } from "@workspace/chat-ui/artifacts/runtime-protocol";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

import { runtimeError } from "./errors";

// Previewing a site (125): its content is parsed and built for a preview
// (`buildSite`'s "preview" target: Tailwind compiled, local files written
// into each page) and one page at a time is shown in a `srcdoc` frame. The
// page this runs in is `site.html`, served with the site CSP, which the
// frame inherits: the instance's public origins, and nothing else.

/** A site, built for preview, or why it couldn't be. */
export const buildPreview = async (
  code: string,
  ports: { readonly compile: CompileTailwind; readonly themeCss: string }
): Promise<Result<BuiltSite, RuntimeError>> => {
  const parsed = siteContentSchema.safeParse(code);
  if (!parsed.success) {
    return err({
      kind: "syntax",
      message: parsed.error.issues
        .map((issue) =>
          [
            issue.path.length > 0 ? issue.path.join(".") : "content",
            issue.message,
          ]
            .join(" ")
            .trim()
        )
        .join("\n"),
    });
  }
  try {
    return ok(await buildSite(parsed.data, ports, "preview"));
  } catch (error) {
    return err(runtimeError("render", error));
  }
};

const navigateSchema = z.object({
  channel: z.literal(SITE_PREVIEW_CHANNEL),
  page: z.string().max(256),
  type: z.literal("navigate"),
});

/**
 * The page a previewed page asked to go to, if the message is one and the
 * page is in the site; `null` for anything else.
 */
export const navigationTarget = (
  data: unknown,
  site: BuiltSite
): string | null => {
  const parsed = navigateSchema.safeParse(data);
  return parsed.success && site.files[parsed.data.page] !== undefined
    ? parsed.data.page
    : null;
};

/** The page a preview opens on. */
export const PREVIEW_START = SITE_ENTRY;
