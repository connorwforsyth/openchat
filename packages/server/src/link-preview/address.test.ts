import { describe, expect, it } from "vitest";

import { isPublicAddress } from "./address";

// The address-range half of the SSRF guard (101): what the fetcher refuses
// to connect to, whatever name led there.

describe("isPublicAddress", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["0.0.0.0", "this network"],
    ["10.0.0.5", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["100.64.0.1", "CGNAT"],
    ["100.100.100.200", "CGNAT (Alibaba metadata)"],
    ["169.254.169.254", "link-local (cloud metadata)"],
    ["169.254.0.1", "link-local"],
    ["192.0.0.192", "IETF protocol (Oracle metadata)"],
    ["192.0.2.1", "documentation"],
    ["198.18.0.1", "benchmarking"],
    ["198.51.100.7", "documentation"],
    ["203.0.113.9", "documentation"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.250", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "broadcast"],
  ])("refuses IPv4 %s (%s)", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
    ["::ffff:7f00:1", "IPv4-mapped loopback, hex"],
    ["::ffff:10.0.0.5", "IPv4-mapped private"],
    ["::ffff:169.254.169.254", "IPv4-mapped metadata"],
    ["0:0:0:0:0:ffff:a9fe:a9fe", "IPv4-mapped metadata, long form"],
    ["::127.0.0.1", "IPv4-compatible"],
    ["64:ff9b::a00:5", "NAT64 of a private address"],
    ["64:ff9b::7f00:1", "NAT64 of loopback"],
    ["2002:7f00:1::1", "6to4 of loopback"],
    ["2002:a9fe:a9fe::", "6to4 of metadata"],
    ["fc00::1", "unique local"],
    ["fd00:ec2::254", "unique local (AWS metadata)"],
    ["fe80::1", "link-local"],
    ["fec0::1", "site-local"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "documentation"],
    ["2001::1", "Teredo"],
    ["100::1", "discard"],
    ["fe80::1%en0", "zoned"],
  ])("refuses IPv6 %s (%s)", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    "93.184.216.34",
    "1.1.1.1",
    "8.8.8.8",
    "172.32.0.1",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "2a00:1450:4009:81f::200e",
    "::ffff:93.184.216.34",
    "64:ff9b::5db8:d822",
  ])("allows public %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each(["localhost", "example.test", "", "1.2.3", "::g", "1.2.3.4.5"])(
    "refuses %j, which isn't an address",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(false);
    }
  );
});
