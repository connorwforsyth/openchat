import { z } from "zod";

/**
 * Every locale the app ships a catalog for. `en` is the source locale; the
 * open-source wave adds a pseudo-locale and real translations (PLAN.md D12).
 */
export const supportedLocales = ["en"] as const;

export const sourceLocale = "en" satisfies SupportedLocale;

export const localeSchema = z.enum(supportedLocales);

export type SupportedLocale = z.infer<typeof localeSchema>;

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return localeSchema.safeParse(value).success;
}
