import { crc32, deflateSync } from "node:zlib";

// The icon pipeline's pure parts (ticket 119): container formats (PNG, ICO,
// ICNS) written by hand, since each is a few headers around PNG data, and the
// menu bar icon's template image derived from the brand's logo. Rendering the
// logo to pixels is the shell's job (brand-assets.ts, with resvg); everything
// here is bytes in, bytes out, so it's tested without a renderer.

/** A square PNG at one size. */
export interface SizedPng {
  readonly png: Uint8Array;
  readonly size: number;
}

/** Pixels as rendered: RGBA, 8 bits a channel, row by row. */
export interface Raster {
  readonly height: number;
  /** resvg's output is premultiplied by alpha. */
  readonly pixels: Uint8Array;
  readonly width: number;
}

/** Coverage, 0–255 per pixel, row by row. */
export interface Mask {
  readonly alpha: Uint8Array;
  readonly height: number;
  readonly width: number;
}

export interface Bounds {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

// ---------------------------------------------------------------------------
// PNG

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** A straight-alpha RGBA PNG (no filtering; these images are tiny). */
export const encodePng = (
  rgba: Uint8Array,
  width: number,
  height: number
): Uint8Array => {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, deflate, no filter, no interlace
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw.set(
      rgba.subarray(row * stride, (row + 1) * stride),
      row * (stride + 1) + 1
    );
  }
  return concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
};

/** A PNG's dimensions from its header, or null if it isn't a PNG. */
export const pngSize = (
  png: Uint8Array
): { readonly height: number; readonly width: number } | null => {
  if (
    png.length < 24 ||
    !PNG_SIGNATURE.every((byte, index) => png[index] === byte)
  ) {
    return null;
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { height: view.getUint32(20), width: view.getUint32(16) };
};

// ---------------------------------------------------------------------------
// ICO (Windows): a directory of PNGs, which Windows reads at every size since Vista.

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

export const encodeIco = (images: readonly SizedPng[]): Uint8Array => {
  const header = new Uint8Array(6 + 16 * images.length);
  const view = new DataView(header.buffer);
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, images.length, true);
  let offset = header.length;
  for (const [index, { png, size }] of images.entries()) {
    if (size < 1 || size > 256) {
      throw new RangeError(`an ICO image is 1–256px, not ${size}`);
    }
    const entry = 6 + 16 * index;
    // 0 means 256 in the one-byte width and height.
    view.setUint8(entry, size % 256);
    view.setUint8(entry + 1, size % 256);
    view.setUint16(entry + 4, 1, true); // colour planes
    view.setUint16(entry + 6, 32, true); // bits per pixel
    view.setUint32(entry + 8, png.length, true);
    view.setUint32(entry + 12, offset, true);
    offset += png.length;
  }
  return concat([header, ...images.map((image) => image.png)]);
};

// ---------------------------------------------------------------------------
// ICNS (macOS): typed PNG entries, as `iconutil` writes them.

/** Each ICNS type and the pixel size its PNG must be. */
export const ICNS_TYPES = [
  ["icp4", 16],
  ["icp5", 32],
  ["ic11", 32], // 16@2x
  ["ic12", 64], // 32@2x
  ["ic07", 128],
  ["ic08", 256],
  ["ic13", 256], // 128@2x
  ["ic09", 512],
  ["ic14", 512], // 256@2x
  ["ic10", 1024], // 512@2x
] as const;

export const ICNS_SIZES = [
  ...new Set(ICNS_TYPES.map(([, size]) => size)),
] as readonly number[];

export const encodeIcns = (images: readonly SizedPng[]): Uint8Array => {
  const bySize = new Map(images.map((image) => [image.size, image.png]));
  const entries = ICNS_TYPES.flatMap(([type, size]) => {
    const png = bySize.get(size);
    if (!png) {
      return [];
    }
    const head = new Uint8Array(8);
    head.set(new TextEncoder().encode(type));
    new DataView(head.buffer).setUint32(4, 8 + png.length);
    return [head, png];
  });
  if (entries.length === 0) {
    throw new RangeError("an ICNS file needs at least one of its sizes");
  }
  const body = concat(entries);
  const head = new Uint8Array(8);
  head.set(new TextEncoder().encode("icns"));
  new DataView(head.buffer).setUint32(4, 8 + body.length);
  return concat([head, body]);
};

// ---------------------------------------------------------------------------
// The menu bar icon: a template image (black, shaped by alpha) from the logo.

/**
 * How far a pixel's colour is from the backdrop, as a share of full range:
 * below the first it's backdrop (a gradient's or shadow's drift), above the
 * second it's fully ink.
 */
const INK_CONTRAST = [0.15, 0.35] as const;
/** Above this share of opaque pixels, the logo has a backdrop (an app-icon tile). */
const BACKDROP_SHARE = 0.5;

const unpremultiply = (value: number, alpha: number): number =>
  alpha === 0 ? 0 : Math.min(255, Math.round((value * 255) / alpha));

/**
 * The backdrop's colour: the per-channel median of the opaque pixels. A
 * median, so a gradient tile lands mid-gradient and the mark doesn't pull it.
 */
const backdropColour = (raster: Raster): readonly [number, number, number] => {
  const histograms = [0, 1, 2].map(() => new Uint32Array(256));
  let total = 0;
  const { pixels } = raster;
  for (let index = 0; index < pixels.length; index += 4) {
    if ((pixels[index + 3] as number) < 250) {
      continue;
    }
    total += 1;
    for (const channel of [0, 1, 2]) {
      const histogram = histograms[channel] as Uint32Array;
      const value = pixels[index + channel] as number;
      histogram[value] = (histogram[value] as number) + 1;
    }
  }
  const median = (histogram: Uint32Array) => {
    let seen = 0;
    for (const [value, count] of histogram.entries()) {
      seen += count;
      if (seen * 2 >= total) {
        return value;
      }
    }
    return 0;
  };
  return [
    median(histograms[0] as Uint32Array),
    median(histograms[1] as Uint32Array),
    median(histograms[2] as Uint32Array),
  ];
};

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * What of the logo is ink. A glyph on transparency (the usual menu bar
 * source) is its own alpha. A logo on a backdrop (an app-icon tile, say)
 * would be a solid blob that way, so then ink is what differs from the
 * backdrop's colour: the mark on the tile.
 */
export const inkMask = (raster: Raster): Mask => {
  const { height, pixels, width } = raster;
  const count = width * height;
  let opaque = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if ((pixels[index] as number) >= 250) {
      opaque += 1;
    }
  }
  const alpha = new Uint8Array(count);
  if (opaque / count <= BACKDROP_SHARE) {
    for (let index = 0; index < count; index += 1) {
      alpha[index] = pixels[index * 4 + 3] as number;
    }
    return { alpha, height, width };
  }
  const [br, bg, bb] = backdropColour(raster);
  for (let index = 0; index < count; index += 1) {
    const a = pixels[index * 4 + 3] as number;
    const distance =
      Math.max(
        Math.abs(unpremultiply(pixels[index * 4] as number, a) - br),
        Math.abs(unpremultiply(pixels[index * 4 + 1] as number, a) - bg),
        Math.abs(unpremultiply(pixels[index * 4 + 2] as number, a) - bb)
      ) / 255;
    alpha[index] = Math.round(a * smoothstep(...INK_CONTRAST, distance));
  }
  return { alpha, height, width };
};

/** The smallest box holding every pixel above `threshold`, or null if none is. */
export const inkBounds = (mask: Mask, threshold = 8): Bounds | null => {
  let top = mask.height;
  let left = mask.width;
  let bottom = -1;
  let right = -1;
  for (let row = 0; row < mask.height; row += 1) {
    for (let column = 0; column < mask.width; column += 1) {
      if ((mask.alpha[row * mask.width + column] as number) > threshold) {
        top = Math.min(top, row);
        bottom = Math.max(bottom, row + 1);
        left = Math.min(left, column);
        right = Math.max(right, column + 1);
      }
    }
  }
  return bottom < 0 ? null : { bottom, left, right, top };
};

/** Area-weighted overlap of [start, end) with the unit cell at `index`. */
const overlap = (start: number, end: number, index: number): number =>
  Math.max(0, Math.min(end, index + 1) - Math.max(start, index));

/**
 * The ink in `bounds`, scaled to fit a `size`-pixel square with `padding`
 * pixels clear on every side, centred, aspect kept. Each output pixel is the
 * exact area average of the source under it, so thin strokes stay smooth.
 */
export const fitMask = (
  mask: Mask,
  bounds: Bounds,
  size: number,
  padding: number
): Mask => {
  const boxW = bounds.right - bounds.left;
  const boxH = bounds.bottom - bounds.top;
  const inner = size - 2 * padding;
  const scale = inner / Math.max(boxW, boxH);
  // Where the box lands in the output, in output pixels.
  const offsetX = (size - boxW * scale) / 2;
  const offsetY = (size - boxH * scale) / 2;
  const alpha = new Uint8Array(size * size);
  for (let row = 0; row < size; row += 1) {
    // The output pixel's extent in source pixels.
    const y0 = bounds.top + (row - offsetY) / scale;
    const y1 = bounds.top + (row + 1 - offsetY) / scale;
    for (let column = 0; column < size; column += 1) {
      const x0 = bounds.left + (column - offsetX) / scale;
      const x1 = bounds.left + (column + 1 - offsetX) / scale;
      let sum = 0;
      for (
        let sy = Math.max(bounds.top, Math.floor(y0));
        sy < Math.min(bounds.bottom, Math.ceil(y1));
        sy += 1
      ) {
        const wy = overlap(y0, y1, sy);
        for (
          let sx = Math.max(bounds.left, Math.floor(x0));
          sx < Math.min(bounds.right, Math.ceil(x1));
          sx += 1
        ) {
          sum +=
            wy *
            overlap(x0, x1, sx) *
            (mask.alpha[sy * mask.width + sx] as number);
        }
      }
      alpha[row * size + column] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { alpha, height: size, width: size };
};

/** A mask as black RGBA, the form macOS recolours as a template image. */
export const templateRgba = (mask: Mask): Uint8Array => {
  const rgba = new Uint8Array(mask.alpha.length * 4);
  for (const [index, value] of mask.alpha.entries()) {
    rgba[index * 4 + 3] = value;
  }
  return rgba;
};

/** The menu bar icon's size in points; macOS menu bar icons are 16–18pt. */
export const TRAY_POINTS = 16;
/** Clear space around the mark, in points, so it sits like a system icon. */
export const TRAY_PADDING_POINTS = 1;

/**
 * The menu bar template icon at 1× and 2× from a rendered logo, or null when
 * the logo has no ink to draw (all backdrop, or empty).
 */
export const trayTemplatePngs = (
  raster: Raster
): { readonly x1: Uint8Array; readonly x2: Uint8Array } | null => {
  const mask = inkMask(raster);
  const bounds = inkBounds(mask);
  if (!bounds) {
    return null;
  }
  const at = (scale: number) => {
    const size = TRAY_POINTS * scale;
    const fitted = fitMask(mask, bounds, size, TRAY_PADDING_POINTS * scale);
    return encodePng(templateRgba(fitted), size, size);
  };
  return { x1: at(1), x2: at(2) };
};
