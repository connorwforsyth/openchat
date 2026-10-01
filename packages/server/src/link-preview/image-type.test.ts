import { describe, expect, it } from "vitest";

import { sniffImageType } from "./image-type";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part
    )
  );

describe("sniffImageType", () => {
  it.each([
    [bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    [bytes([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    [bytes("GIF89a"), "image/gif"],
    [bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "), "image/webp"],
    [bytes([0, 0, 0, 0x20], "ftypavif"), "image/avif"],
    [bytes([0, 0, 1, 0, 1, 0]), "image/x-icon"],
    [bytes("BM"), "image/bmp"],
  ])("recognises %#", (input, type) => {
    expect(sniffImageType(input)).toBe(type);
  });

  it.each([
    bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    bytes("<!doctype html><script>alert(1)</script>"),
    bytes('<?xml version="1.0"?><svg/>'),
    bytes(""),
  ])("refuses markup and anything unknown %#", (input) => {
    expect(sniffImageType(input)).toBeNull();
  });
});
