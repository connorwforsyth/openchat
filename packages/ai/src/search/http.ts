import { type AsyncResult, err, ok } from "@workspace/shared/result";
import type { z } from "zod";

import type { SearchBackendError } from "../ports/search-backend";

// The one HTTP call every web search backend makes, with its failures as
// port errors. Messages name the backend and the status, never a response
// body (it can echo the key) or the key itself.

export type FetchFunction = typeof globalThis.fetch;

const retryAfterSeconds = (response: Response): number | null => {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export const requestJson = async <T>(
  {
    fetch,
    label,
    schema,
    signal,
  }: {
    readonly fetch: FetchFunction;
    readonly label: string;
    readonly schema: z.ZodType<T>;
    readonly signal?: AbortSignal;
  },
  url: string,
  init: RequestInit
): AsyncResult<T, SearchBackendError> => {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch {
    return err({
      message: `${label} couldn't be reached.`,
      type: "unavailable",
    });
  }
  if (response.status === 429) {
    return err({
      retryAfterSeconds: retryAfterSeconds(response),
      type: "rate_limited",
    });
  }
  if (!response.ok) {
    return err({
      message: `${label} answered ${response.status}.`,
      type: "unavailable",
    });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return err({
      message: `${label} didn't answer with JSON.`,
      type: "unavailable",
    });
  }
  const parsed = schema.safeParse(body);
  return parsed.success
    ? ok(parsed.data)
    : err({
        message: `${label} answered in an unexpected shape.`,
        type: "unavailable",
      });
};

/** An ISO instant, or `null` for anything a backend sends that isn't a date. */
export const toTimestamp = (value: unknown): string | null => {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Backends mark matches with HTML (`<strong>`); results are plain text. */
export const plainText = (value: string | null | undefined): string =>
  (value ?? "")
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll(/\s+/g, " ")
    .trim();

/** Only http(s) URLs make it into results, since they become links. */
export const isWebUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

/** The language part of a BCP 47 tag (`en-GB` → `en`), which is all most backends take. */
export const languageOf = (locale: string | undefined): string | undefined =>
  locale?.split("-")[0]?.toLowerCase() || undefined;
