import type { SupportedLocale } from "@workspace/i18n/locales";
import { resolveLocale } from "@workspace/i18n/negotiate";
import { headers } from "next/headers";
import { cache } from "react";

import { getViewer } from "./server-session";

/**
 * The locale for this request (D12): the signed-in user's saved
 * `user.locale` when it's set and supported, else negotiated from
 * `Accept-Language`. Cached so the layouts and the page resolve it once per
 * request; the viewer lookup is shared with the app layout.
 */
export const requestLocale = cache(async (): Promise<SupportedLocale> => {
  const [requestHeaders, viewer] = await Promise.all([headers(), getViewer()]);
  return resolveLocale({
    acceptLanguage: requestHeaders.get("accept-language"),
    userLocale: viewer.kind === "signed_in" ? viewer.me.user.locale : null,
  });
});
