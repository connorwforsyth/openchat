// TEST ONLY. The e2e suite serves its fixture site on loopback, which the
// fetcher refuses like any private address. This env variable lets exact
// loopback origins through so the suite can preview its own pages. It is
// never read from app.config.yaml, and it is ignored:
// - for anything but `http://127.0.0.1:<port>`, `http://[::1]:<port>` or
//   `http://localhost:<port>` (an explicit port, no path);
// - in production, unless the instance's own public URL (BETTER_AUTH_URL)
//   is itself on loopback, as it is under the e2e harness and never on a
//   real deployment.
// Even when it applies, it only unlocks the listed origins on this machine;
// every other address is checked as usual.

export const TEST_ALLOW_ORIGINS_ENV = "LINK_PREVIEW_TEST_ALLOW_ORIGINS";

type Env = Readonly<Record<string, string | undefined>>;

const TRAILING_SLASH = /\/$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

const loopbackOrigin = (entry: string): string | null => {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    return null;
  }
  const exact = url.origin === entry.replace(TRAILING_SLASH, "");
  return url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.port !== "" &&
    exact
    ? url.origin
    : null;
};

const servesOnLoopback = (env: Env): boolean => {
  const own = env.BETTER_AUTH_URL?.trim();
  if (!own) {
    return false;
  }
  try {
    return LOOPBACK_HOSTS.has(new URL(own).hostname);
  } catch {
    return false;
  }
};

export const testAllowOrigins = (
  env: Env,
  warn: (message: string) => void = () => undefined
): ReadonlySet<string> => {
  const raw = env[TEST_ALLOW_ORIGINS_ENV]?.trim();
  if (!raw) {
    return new Set();
  }
  if (env.NODE_ENV === "production" && !servesOnLoopback(env)) {
    warn(`${TEST_ALLOW_ORIGINS_ENV} is for tests and is ignored in production`);
    return new Set();
  }
  const origins = new Set<string>();
  for (const entry of raw.split(",").map((part) => part.trim())) {
    const origin = loopbackOrigin(entry);
    if (origin) {
      origins.add(origin);
    } else if (entry) {
      warn(
        `${TEST_ALLOW_ORIGINS_ENV}: ignoring "${entry}" (only http loopback origins with a port)`
      );
    }
  }
  if (origins.size > 0) {
    warn(
      `TEST ONLY: link previews may fetch ${[...origins].join(", ")} (${TEST_ALLOW_ORIGINS_ENV})`
    );
  }
  return origins;
};
