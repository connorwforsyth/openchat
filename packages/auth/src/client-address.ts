import { BlockList, isIP } from "node:net";

// Who is on the other end of a request, for Better Auth's rate limits and
// the address it records on a session (ticket 044). `X-Forwarded-For` is a
// list anyone can start: a client may send its own, and each proxy appends
// the address it saw. So the list is read from the right, and an entry is
// believed only when the hop that wrote the entries after it is one of
// `TRUSTED_PROXIES`. With none configured, only the last entry counts: the
// address the nearest hop saw (or, with no proxy at all, the connection's
// own address, which Next.js puts there when the request carries none).

/**
 * The header the resolved address travels in to Better Auth. Whatever a
 * client sends under this name is dropped first, so it can't be forged.
 */
export const CLIENT_ADDRESS_HEADER = "x-resolved-client-address";

export interface TrustedProxies {
  /** Parsed entries, for checks; empty means no proxy is trusted. */
  readonly list: BlockList;
  readonly size: number;
}

export interface ParsedTrustedProxies {
  /** Entries that are neither an IP address nor a CIDR range; ignored. */
  readonly invalid: readonly string[];
  readonly proxies: TrustedProxies;
}

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const SEPARATORS = /[\s,]+/;
const DIGITS = /^\d+$/;

/** `::ffff:192.0.2.1` is `192.0.2.1`; anything else as it came, trimmed. */
const normalise = (address: string): string => {
  const trimmed = address.trim();
  // `[::1]:443` and `192.0.2.1:443` (some proxies add the port).
  const bracketed = trimmed.startsWith("[")
    ? trimmed.slice(1, trimmed.indexOf("]"))
    : trimmed;
  const withoutPort =
    isIP(bracketed) === 0 && bracketed.split(":").length === 2
      ? (bracketed.split(":")[0] ?? bracketed)
      : bracketed;
  return IPV4_MAPPED.exec(withoutPort)?.[1] ?? withoutPort;
};

const familyOf = (address: string): "ipv4" | "ipv6" | null => {
  switch (isIP(address)) {
    case 4:
      return "ipv4";
    case 6:
      return "ipv6";
    default:
      return null;
  }
};

/** Adds one `address` or `address/prefix` entry; `false` if it isn't one. */
const addEntry = (list: BlockList, entry: string): boolean => {
  const slash = entry.indexOf("/");
  const address = normalise(slash === -1 ? entry : entry.slice(0, slash));
  const family = familyOf(address);
  if (!family) {
    return false;
  }
  if (slash === -1) {
    list.addAddress(address, family);
    return true;
  }
  const prefixText = entry.slice(slash + 1);
  const prefix = Number(prefixText);
  const max = family === "ipv4" ? 32 : 128;
  if (!DIGITS.test(prefixText) || prefix > max) {
    return false;
  }
  list.addSubnet(address, prefix, family);
  return true;
};

/** `TRUSTED_PROXIES`: IP addresses and CIDR ranges, separated by commas or spaces. */
export const parseTrustedProxies = (
  value: string | undefined
): ParsedTrustedProxies => {
  const list = new BlockList();
  const invalid: string[] = [];
  let size = 0;
  for (const entry of (value ?? "").split(SEPARATORS)) {
    if (entry === "") {
      continue;
    }
    if (addEntry(list, entry)) {
      size += 1;
    } else {
      invalid.push(entry);
    }
  }
  return { invalid, proxies: { list, size } };
};

const isTrusted = (proxies: TrustedProxies, address: string): boolean => {
  const family = familyOf(address);
  return (
    family !== null && proxies.size > 0 && proxies.list.check(address, family)
  );
};

/**
 * The client's address from `X-Forwarded-For`: from the right, skipping
 * trusted proxies, the first address that isn't one. When every hop is
 * trusted (a request from the proxy's own host), the leftmost. `null` when
 * the header is missing or the deciding entry isn't an address.
 */
export const clientAddressFrom = (
  forwardedFor: string | null,
  proxies: TrustedProxies
): string | null => {
  const hops = (forwardedFor ?? "")
    .split(",")
    .map(normalise)
    .filter((hop) => hop !== "");
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index] ?? "";
    if (!familyOf(hop)) {
      return null;
    }
    if (index === 0 || !isTrusted(proxies, hop)) {
      return hop;
    }
  }
  return null;
};

/**
 * The request as Better Auth should see it: any client-sent
 * `CLIENT_ADDRESS_HEADER` removed, and the resolved address set in its place.
 */
export const withClientAddress = (
  request: Request,
  proxies: TrustedProxies
): Request => {
  const headers = new Headers(request.headers);
  headers.delete(CLIENT_ADDRESS_HEADER);
  const address = clientAddressFrom(headers.get("x-forwarded-for"), proxies);
  if (address) {
    headers.set(CLIENT_ADDRESS_HEADER, address);
  }
  return new Request(request, { headers });
};
