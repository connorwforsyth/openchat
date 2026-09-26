import {
  isSupportedLocale,
  type SupportedLocale,
  sourceLocale,
  supportedLocales,
} from "./locales";

interface LanguageRange {
  quality: number;
  tag: string;
}

/**
 * Parses an `Accept-Language` header into ranges, best first. Malformed parts
 * are skipped: the header is client input and must never fail a request.
 */
export function parseAcceptLanguage(
  header: string | null | undefined
): LanguageRange[] {
  if (!header) {
    return [];
  }
  const ranges: (LanguageRange & { order: number })[] = [];
  for (const [order, part] of header.split(",").entries()) {
    const [rawTag, ...params] = part.trim().split(";");
    const tag = rawTag?.trim().toLowerCase();
    if (!tag) {
      continue;
    }
    const qParam = params.find((param) => param.trim().startsWith("q="));
    const quality = qParam ? Number(qParam.trim().slice(2)) : 1;
    if (Number.isNaN(quality) || quality <= 0 || quality > 1) {
      continue;
    }
    ranges.push({ order, quality, tag });
  }
  // Stable by quality, then by the order the client listed them.
  return ranges
    .sort((a, b) => b.quality - a.quality || a.order - b.order)
    .map(({ tag, quality }) => ({ quality, tag }));
}

function matchTag<L extends string>(
  tag: string,
  available: readonly L[]
): L | undefined {
  const lower = available.map((locale) => locale.toLowerCase());
  const exact = lower.indexOf(tag);
  if (exact !== -1) {
    return available[exact];
  }
  // `en-GB` falls back to `en`; `en` also accepts `en-US` if that is all we have.
  const [base] = tag.split("-");
  const byBase = lower.findIndex(
    (locale) => locale === base || locale.split("-")[0] === base
  );
  return byBase === -1 ? undefined : available[byBase];
}

/**
 * Picks the best supported locale for an `Accept-Language` header, falling
 * back to the source locale. `*` means "anything", so it also gets the fallback.
 */
export function negotiateLocale<L extends string>(
  header: string | null | undefined,
  available: readonly L[],
  fallback: L
): L {
  for (const { tag } of parseAcceptLanguage(header)) {
    if (tag === "*") {
      return fallback;
    }
    const match = matchTag(tag, available);
    if (match) {
      return match;
    }
  }
  return fallback;
}

/**
 * The user's saved `user.locale` wins over the browser's header when it is
 * still a supported locale (a removed locale falls through to negotiation).
 */
export function resolveLocale({
  acceptLanguage,
  userLocale,
}: {
  acceptLanguage?: string | null;
  userLocale?: string | null;
}): SupportedLocale {
  if (isSupportedLocale(userLocale)) {
    return userLocale;
  }
  return negotiateLocale(acceptLanguage, supportedLocales, sourceLocale);
}
