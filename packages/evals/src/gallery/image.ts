import { crc32, deflateSync } from "node:zlib";

// The gallery's `image` artifact, drawn here rather than by an image model:
// a dawn street scene (sky, stars, sun, three rows of rooftops, lit
// windows) rendered pixel by pixel and encoded as a PNG. Deterministic, so
// every seed stores the same picture. Pure.

type Rgb = readonly [number, number, number];

const WIDTH = 1600;
const HEIGHT = 1000;

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const SKY: readonly (readonly [number, Rgb])[] = [
  [0, [34, 38, 82]],
  [0.38, [120, 84, 128]],
  [0.58, [214, 128, 120]],
  [0.74, [248, 184, 124]],
  [0.86, [252, 218, 160]],
];

const skyAt = (v: number): Rgb => {
  for (let index = 1; index < SKY.length; index += 1) {
    const [end, to] = SKY[index] ?? [1, [0, 0, 0]];
    const [start, from] = SKY[index - 1] ?? [0, [0, 0, 0]];
    if (v <= end) {
      return mix(from, to, (v - start) / (end - start));
    }
  }
  return SKY.at(-1)?.[1] ?? [0, 0, 0];
};

/** A small seeded generator (Park and Miller's), so the skyline is the same every run. */
const random = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 16_807) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
};

interface Building {
  readonly lit: number;
  /** Where the walls end and the roof starts. */
  readonly wallTop: number;
  readonly x0: number;
  readonly x1: number;
}

interface Layer {
  readonly buildings: readonly Building[];
  readonly colour: Rgb;
  /** The roofline's height at each column, in pixels from the top. */
  readonly top: Float64Array;
}

const skyline = (
  seed: number,
  base: number,
  minHeight: number,
  maxHeight: number,
  colour: Rgb
): Layer => {
  const next = random(seed);
  const top = new Float64Array(WIDTH);
  const buildings: Building[] = [];
  let x = -Math.floor(next() * 80);
  while (x < WIDTH) {
    const width = 70 + Math.floor(next() * 150);
    const height = minHeight + next() * (maxHeight - minHeight);
    const gable = next() < 0.45;
    const chimney = !gable && next() < 0.5;
    const x0 = x;
    const x1 = x + width;
    const mid = (x0 + x1) / 2;
    const peak = gable ? Math.min(width * 0.32, 70) : 0;
    for (
      let column = Math.max(0, x0);
      column < Math.min(WIDTH, x1);
      column += 1
    ) {
      const fromMid = Math.abs(column + 0.5 - mid) / (width / 2);
      let roof = base - height - peak * (1 - fromMid);
      if (
        chimney &&
        column > x0 + width * 0.7 &&
        column < x0 + width * 0.7 + 16
      ) {
        roof -= 26;
      }
      top[column] = roof;
    }
    buildings.push({ lit: next(), wallTop: base - height, x0, x1 });
    x = x1 + (next() < 0.25 ? 8 + Math.floor(next() * 30) : 0);
  }
  for (let column = 0; column < WIDTH; column += 1) {
    if (top[column] === 0) {
      top[column] = base;
    }
  }
  return { buildings, colour, top };
};

const LAYERS: readonly Layer[] = [
  skyline(7, 820, 40, 120, [184, 116, 128]),
  skyline(21, 880, 60, 170, [118, 66, 96]),
  skyline(42, 950, 90, 230, [50, 30, 54]),
];

const WINDOW: Rgb = [255, 200, 118];

/** Whether (x, y) is a lit window on the nearest row of houses. */
const litWindow = (x: number, y: number): boolean => {
  const building = LAYERS.at(-1)?.buildings.find(
    (each) => x >= each.x0 && x < each.x1
  );
  if (!building || building.lit < 0.12) {
    return false;
  }
  const pitch = 36;
  const count = Math.floor((building.x1 - building.x0 - 20) / pitch);
  const start =
    building.x0 + (building.x1 - building.x0 - (count * pitch - 20)) / 2;
  const fromLeft = x - start;
  const fromTop = y - building.wallTop - 30;
  if (fromLeft < 0 || fromLeft >= count * pitch || fromTop < 0) {
    return false;
  }
  const column = Math.floor(fromLeft / pitch);
  const row = Math.floor(fromTop / 46);
  // Only whole windows: none that the street would cut in half.
  if (building.wallTop + 30 + row * 46 + 22 > 925) {
    return false;
  }
  const on =
    Math.sin(column * 12.9898 + row * 78.233 + building.lit * 43.1) > -0.15;
  return on && fromLeft % pitch < 16 && fromTop % 46 < 22;
};

const STARS = (() => {
  const next = random(3);
  return Array.from({ length: 70 }, () => ({
    size: 0.8 + next() * 1.4,
    x: next() * WIDTH,
    y: next() * 380,
  }));
})();

const STAR_COLOUR: Rgb = [255, 248, 230];

const SUN = { radius: 96, x: 1010, y: 690 } as const;
const SUN_COLOUR: Rgb = [255, 240, 200];

const pixel = (x: number, y: number): Rgb => {
  let colour = skyAt(y / HEIGHT);
  if (y < 400) {
    for (const star of STARS) {
      const light = clamp01(star.size - Math.hypot(x - star.x, y - star.y));
      if (light > 0) {
        colour = mix(colour, STAR_COLOUR, light * (1 - star.y / 400) * 0.9);
      }
    }
  }
  const distance = Math.hypot(x - SUN.x, y - SUN.y);
  const glow = Math.exp(-distance / 260) * 0.55;
  colour = mix(colour, SUN_COLOUR, glow);
  colour = mix(colour, SUN_COLOUR, clamp01(SUN.radius - distance + 0.5));
  for (const layer of LAYERS) {
    const coverage = clamp01(y - (layer.top[x] ?? HEIGHT) + 0.5);
    colour = mix(colour, layer.colour, coverage);
  }
  if (litWindow(x, y)) {
    colour = WINDOW;
  }
  return colour;
};

const chunk = (type: string, data: Uint8Array): Buffer => {
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
};

/** The scene as PNG bytes: 8-bit RGB, each row filtered against the one above. */
export const renderDawnPng = (): Buffer => {
  const stride = WIDTH * 3;
  const rows = Buffer.alloc((stride + 1) * HEIGHT);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < HEIGHT; y += 1) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < WIDTH; x += 1) {
      const [r, g, b] = pixel(x, y);
      row[x * 3] = Math.round(r);
      row[x * 3 + 1] = Math.round(g);
      row[x * 3 + 2] = Math.round(b);
    }
    const offset = y * (stride + 1);
    // Filter type 2 (Up): smooth skies compress to almost nothing.
    rows[offset] = 2;
    for (let index = 0; index < stride; index += 1) {
      rows[offset + 1 + index] =
        ((row[index] ?? 0) - (previous[index] ?? 0) + 256) % 256;
    }
    previous = row;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
};
