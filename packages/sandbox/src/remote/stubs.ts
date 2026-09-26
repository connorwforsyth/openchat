import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import { err } from "@workspace/shared/result";

import type { SandboxError, SandboxFactory } from "../ports/sandbox";

// Remote providers (D7): E2B, Vercel Sandbox and Microsandbox. The interface
// is in place so config, the provider picker and the handlers treat them like
// any other provider; the SDK adapters land in their own tickets. Until then
// they say so instead of pretending.

type RemoteProvider = Extract<
  SandboxProvider,
  "e2b" | "vercel" | "microsandbox"
>;

const NAMES: Readonly<Record<RemoteProvider, string>> = {
  e2b: "E2B",
  microsandbox: "Microsandbox",
  vercel: "Vercel Sandbox",
};

export const createUnavailableFactory = (
  provider: RemoteProvider
): SandboxFactory => {
  const error: SandboxError = {
    message: `${NAMES[provider]} sandboxes aren't supported yet`,
    type: "unavailable",
  };
  return {
    attach: () => Promise.resolve(err(error)),
    create: () => Promise.resolve(err(error)),
    provider,
  };
};
