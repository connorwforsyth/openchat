import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  encodeIcns,
  encodeIco,
  encodePng,
  fitMask,
  ICNS_SIZES,
  ICNS_TYPES,
  inkBounds,
  inkMask,
  type Mask,
  pngSize,
  type Raster,
  templateRgba,
  trayTemplatePngs,
} from "./icons";

/** A raster from a function of (x, y) to premultiplied RGBA. */
const raster = (
  size: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number]
): Raster => {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      pixels.set(pixel(x, y), (y * size + x) * 4);
    }
  }
  return { height: size, pixels, width: size };
};

/** Decodes the unfiltered RGBA PNGs encodePng writes. */
const decode = (png: Uint8Array) => {
  const size = pngSize(png);
  if (!size) {
    throw new Error("not a PNG");
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Uint8Array[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    if (type === "IDAT") {
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = size.width * 4;
  const rgba = new Uint8Array(stride * size.height);
  for (let row = 0; row < size.height; row += 1) {
    if (raw[row * (stride + 1)] !== 0) {
      throw new Error(`row ${row} is filtered; encodePng writes none`);
    }
    rgba.set(
      raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)),
      row * stride
    );
  }
  return { ...size, rgba };
};

const fakePng = (size: number) =>
  encodePng(new Uint8Array(size * size * 4), size, size);

describe("encodePng", () => {
  it("round-trips pixels and size", () => {
    const rgba = Uint8Array.from({ length: 3 * 2 * 4 }, (_, index) => index);
    const decoded = decode(encodePng(rgba, 3, 2));
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    expect([...decoded.rgba]).toEqual([...rgba]);
  });

  it("is recognised by pngSize, and other bytes aren't", () => {
    expect(pngSize(fakePng(4))).toEqual({ height: 4, width: 4 });
    expect(pngSize(new Uint8Array(30))).toBeNull();
  });
});

describe("encodeIco", () => {
  it("writes a directory of PNG entries, 256 as 0", () => {
    const images = [16, 256].map((size) => ({ png: fakePng(size), size }));
    const ico = encodeIco(images);
    const view = new DataView(ico.buffer);
    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(2);
    // First entry: 16px.
    expect(ico[6]).toBe(16);
    expect(view.getUint16(6 + 6, true)).toBe(32);
    const firstLength = view.getUint32(6 + 8, true);
    const firstOffset = view.getUint32(6 + 12, true);
    expect(firstOffset).toBe(6 + 16 * 2);
    expect(
      pngSize(ico.subarray(firstOffset, firstOffset + firstLength))
    ).toEqual({ height: 16, width: 16 });
    // Second: 256px is written as 0, its data right after the first.
    expect(ico[6 + 16]).toBe(0);
    expect(view.getUint32(6 + 16 + 12, true)).toBe(firstOffset + firstLength);
    expect(ico.length).toBe(
      firstOffset + firstLength + (images[1]?.png.length ?? 0)
    );
  });

  it("refuses sizes ICO can't hold", () => {
    expect(() => encodeIco([{ png: fakePng(1), size: 512 }])).toThrow(
      RangeError
    );
  });
});

describe("encodeIcns", () => {
  const entries = (icns: Uint8Array) => {
    const view = new DataView(icns.buffer);
    const found: [string, number][] = [];
    let offset = 8;
    while (offset < icns.length) {
      const type = new TextDecoder().decode(icns.subarray(offset, offset + 4));
      const length = view.getUint32(offset + 4);
      const size = pngSize(icns.subarray(offset + 8, offset + length));
      found.push([type, size?.width ?? -1]);
      offset += length;
    }
    return found;
  };

  it("writes every type with a PNG of its size", () => {
    const icns = encodeIcns(
      ICNS_SIZES.map((size) => ({ png: fakePng(size), size }))
    );
    expect(new TextDecoder().decode(icns.subarray(0, 4))).toBe("icns");
    expect(new DataView(icns.buffer).getUint32(4)).toBe(icns.length);
    expect(entries(icns)).toEqual(
      ICNS_TYPES.map(([type, size]) => [type, size])
    );
  });

  it("skips the types whose size is missing", () => {
    const icns = encodeIcns([{ png: fakePng(32), size: 32 }]);
    expect(entries(icns)).toEqual([
      ["icp5", 32],
      ["ic11", 32],
    ]);
  });

  it("refuses to write an empty file", () => {
    expect(() => encodeIcns([{ png: fakePng(3), size: 3 }])).toThrow(
      RangeError
    );
  });
});

describe("inkMask", () => {
  it("is the alpha of a glyph on transparency", () => {
    const glyph = raster(4, (x) => (x < 2 ? [0, 0, 0, 200] : [0, 0, 0, 0]));
    expect([...inkMask(glyph).alpha.subarray(0, 4)]).toEqual([200, 200, 0, 0]);
  });

  it("is the mark, not the tile, on an opaque backdrop", () => {
    // A dark tile with a white 2×2 mark in the middle; a light gradient on
    // the tile stays backdrop.
    const tile = raster(6, (x, y) => {
      const mark = x >= 2 && x < 4 && y >= 2 && y < 4;
      return mark ? [255, 255, 255, 255] : [40 + y * 4, 40, 40, 255];
    });
    const mask = inkMask(tile);
    expect(mask.alpha[2 * 6 + 2]).toBe(255);
    expect(mask.alpha[0]).toBe(0);
    expect(mask.alpha[5 * 6 + 5]).toBe(0);
  });

  it("un-premultiplies before comparing colours", () => {
    // Half-transparent white over the tile's edge is still a mark.
    const tile = raster(4, (x) =>
      x === 0 ? [128, 128, 128, 128] : [0, 0, 0, 255]
    );
    expect(inkMask(tile).alpha[0]).toBe(128);
  });
});

describe("inkBounds", () => {
  const mask = (alpha: number[], width: number): Mask => ({
    alpha: Uint8Array.from(alpha),
    height: alpha.length / width,
    width,
  });

  it("boxes the ink, ignoring faint pixels", () => {
    expect(
      inkBounds(mask([0, 0, 0, 3, 0, 255, 255, 0, 0, 255, 0, 0], 4))
    ).toEqual({ bottom: 3, left: 1, right: 3, top: 1 });
  });

  it("is null for an empty mask", () => {
    expect(inkBounds(mask([0, 0, 0, 0], 2))).toBeNull();
  });
});

describe("fitMask", () => {
  it("centres a wide box in the square, aspect kept, with padding", () => {
    // A solid 8×4 box into 6px with 1px padding: 4×2, centred.
    const source: Mask = {
      alpha: new Uint8Array(8 * 4).fill(255),
      height: 4,
      width: 8,
    };
    const fitted = fitMask(
      source,
      { bottom: 4, left: 0, right: 8, top: 0 },
      6,
      1
    );
    const rows = [...new Array(6).keys()].map((row) =>
      [...fitted.alpha.subarray(row * 6, row * 6 + 6)].map((value) =>
        value > 127 ? 1 : 0
      )
    );
    expect(rows).toEqual([
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ]);
  });

  it("averages the area under each pixel", () => {
    // A 2×2 checkerboard into 1px is half covered.
    const source: Mask = {
      alpha: Uint8Array.of(255, 0, 0, 255),
      height: 2,
      width: 2,
    };
    expect(
      fitMask(source, { bottom: 2, left: 0, right: 2, top: 0 }, 1, 0).alpha[0]
    ).toBe(128);
  });
});

describe("templateRgba", () => {
  it("is black, shaped by alpha", () => {
    expect([
      ...templateRgba({ alpha: Uint8Array.of(7, 255), height: 1, width: 2 }),
    ]).toEqual([0, 0, 0, 7, 0, 0, 0, 255]);
  });
});

describe("trayTemplatePngs", () => {
  it("makes 16px and 32px template images from a logo", () => {
    const disc = raster(64, (x, y) =>
      Math.hypot(x - 32, y - 32) < 20 ? [0, 0, 0, 255] : [0, 0, 0, 0]
    );
    const pngs = trayTemplatePngs(disc);
    expect(pngs).not.toBeNull();
    const x1 = decode(pngs?.x1 ?? new Uint8Array());
    const x2 = decode(pngs?.x2 ?? new Uint8Array());
    expect([x1.width, x2.width]).toEqual([16, 32]);
    // Black everywhere; the disc fills the middle, the padding stays clear.
    expect(
      x1.rgba.filter((_, index) => index % 4 !== 3).every((v) => v === 0)
    ).toBe(true);
    expect(x1.rgba[(8 * 16 + 8) * 4 + 3]).toBe(255);
    expect(x1.rgba[3]).toBe(0);
  });

  it("is null when there's no ink", () => {
    expect(trayTemplatePngs(raster(8, () => [0, 0, 0, 0]))).toBeNull();
  });
});
