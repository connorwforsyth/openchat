import { isIPv4, isIPv6 } from "node:net";

// Which addresses the link-preview fetcher may connect to (101, SSRF). Only
// globally routable unicast: never loopback, private, link-local (cloud
// metadata lives at 169.254.169.254), CGNAT, multicast, documentation or
// reserved ranges, in IPv4 or IPv6. IPv6 forms that carry an IPv4 address
// (mapped, NAT64, 6to4) are judged by the address they carry. Pure: the
// fetcher resolves names and calls this on every answer.

type Bytes = readonly number[];

interface Range {
  readonly bytes: Bytes;
  readonly prefix: number;
}

const parseIPv4 = (ip: string): Bytes | null =>
  isIPv4(ip) ? ip.split(".").map(Number) : null;

const HEXTET = /^[0-9a-f]{1,4}$/i;

const hextets = (part: string): number[] | null => {
  if (part === "") {
    return [];
  }
  const out: number[] = [];
  for (const group of part.split(":")) {
    if (!HEXTET.test(group)) {
      return null;
    }
    out.push(Number.parseInt(group, 16));
  }
  return out;
};

/** 16 bytes, or `null` for anything that isn't a plain IPv6 address (zones included). */
const parseIPv6 = (ip: string): Bytes | null => {
  if (!isIPv6(ip) || ip.includes("%")) {
    return null;
  }
  let text = ip;
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const dotted = parseIPv4(text.slice(lastColon + 1));
  if (dotted) {
    const [a = 0, b = 0, c = 0, d = 0] = dotted;
    tail = [a * 256 + b, c * 256 + d];
    text = `${text.slice(0, lastColon + 1)}`;
    text = text.endsWith("::") ? text : text.slice(0, -1);
  }
  const [head = "", rest] = text.split("::");
  const front = hextets(head);
  const back = rest === undefined ? [] : hextets(rest);
  if (!(front && back)) {
    return null;
  }
  const missing = 8 - front.length - back.length - tail.length;
  if (missing < 0 || (rest === undefined && missing !== 0)) {
    return null;
  }
  const groups = [...front, ...new Array<number>(missing).fill(0), ...back];
  return [...groups, ...tail].flatMap((group) => [
    Math.floor(group / 256),
    group % 256,
  ]);
};

const range = (cidr: string): Range => {
  const [address = "", prefix = ""] = cidr.split("/");
  const bytes = parseIPv4(address) ?? parseIPv6(address);
  if (!bytes) {
    throw new Error(`bad range ${cidr}`);
  }
  return { bytes, prefix: Number(prefix) };
};

const inRange = (bytes: Bytes, { bytes: base, prefix }: Range): boolean => {
  if (bytes.length !== base.length) {
    return false;
  }
  for (let bit = 0; bit < prefix; bit += 8) {
    const index = bit / 8;
    // The byte's leading `bits` bits, by division rather than masks.
    const drop = 2 ** (8 - Math.min(8, prefix - bit));
    if (
      Math.floor((bytes[index] ?? 0) / drop) !==
      Math.floor((base[index] ?? 0) / drop)
    ) {
      return false;
    }
  }
  return true;
};

// IANA's IPv4 special-purpose registry, minus nothing: none of these is a
// web server a citation should reach.
const IPV4_BLOCKED = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
].map(range);

const IPV6_GLOBAL_UNICAST = range("2000::/3");

// Inside 2000::/3 but not the open internet.
const IPV6_BLOCKED = [
  "2001::/23",
  "2001:db8::/32",
  "3fff::/20",
  "5f00::/16",
].map(range);

const IPV4_MAPPED = range("::ffff:0:0/96");
const NAT64 = range("64:ff9b::/96");
const SIX_TO_FOUR = range("2002::/16");

const isPublicIPv4 = (bytes: Bytes): boolean =>
  !IPV4_BLOCKED.some((blocked) => inRange(bytes, blocked));

const isPublicIPv6 = (bytes: Bytes): boolean => {
  if (inRange(bytes, IPV4_MAPPED) || inRange(bytes, NAT64)) {
    return isPublicIPv4(bytes.slice(12));
  }
  if (inRange(bytes, SIX_TO_FOUR)) {
    return isPublicIPv4(bytes.slice(2, 6));
  }
  return (
    inRange(bytes, IPV6_GLOBAL_UNICAST) &&
    !IPV6_BLOCKED.some((blocked) => inRange(bytes, blocked))
  );
};

/** Whether `ip` (a literal address, not a name) is on the open internet. */
export const isPublicAddress = (ip: string): boolean => {
  const v4 = parseIPv4(ip);
  if (v4) {
    return isPublicIPv4(v4);
  }
  const v6 = parseIPv6(ip);
  return v6 ? isPublicIPv6(v6) : false;
};
