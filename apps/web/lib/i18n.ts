import type { SupportedLocale } from "@workspace/i18n/locales";
import { resolveLocale } from "@workspace/i18n/negotiate";
import { headers } from "next/headers";
import { cache } from "react";

/**
 * The locale for this request, negotiated from `Accept-Language`. Once auth
 * lands, the signed-in user's saved `user.locale` goes in as `userLocale` and
 * wins. Cached so the layout and page negotiate once per request.
 */
export const requestLocale = cache(async (): Promise<SupportedLocale> => {
  const requestHeaders = await headers();
  return resolveLocale({
    acceptLanguage: requestHeaders.get("accept-language"),
  });
});
