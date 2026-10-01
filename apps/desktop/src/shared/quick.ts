import { z } from "zod";

import { decideNavigation } from "./navigation";

// The Quick AI window (118): a small floating window that shows one page of
// the instance's web app, `/quick` (the composer and a compact reply). It
// has the main window's locks (D24) and one more: it never wanders off that
// page. Anything else on the instance (a chat, sign-in) belongs in the main
// window.

/** The instance's page the Quick AI window shows. */
export const QUICK_PATH = "/quick";

export const quickNavigationSchema = z.enum([
  "allow",
  "main",
  "external",
  "deny",
]);
export type QuickNavigation = z.infer<typeof quickNavigationSchema>;

/**
 * Where a navigation from the Quick AI window goes: `/quick` stays, the rest
 * of the instance opens in the main window, and other origins follow the
 * main window's rules (the system browser, or nowhere).
 */
export const decideQuickNavigation = (
  target: string,
  instanceOrigin: string | null
): QuickNavigation => {
  const decision = decideNavigation(target, instanceOrigin);
  if (decision !== "allow") {
    return decision;
  }
  return new URL(target).pathname === QUICK_PATH ? "allow" : "main";
};

/**
 * The URL to show in the main window for one the Quick AI window was sent
 * to. A sign-in redirect asks to come back to `/quick`; in the main window
 * that would show the bare quick page, so it lands on the home page instead.
 */
export const mainUrlFor = (target: string): string => {
  const url = new URL(target);
  const next = url.searchParams.get("next");
  if (next !== null && new URL(next, url).pathname === QUICK_PATH) {
    url.searchParams.delete("next");
  }
  return url.toString();
};

/** The Quick AI page on an instance. */
export const quickUrl = (instanceOrigin: string): string =>
  new URL(QUICK_PATH, instanceOrigin).toString();
