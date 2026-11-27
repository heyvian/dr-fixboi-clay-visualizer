import { Color } from 'three';
import { clayFrequencies } from './clay-material.js';
import { encodeTexturePng } from './fawn-png.js';

export const clayTileMillimeters = 32;
const resolution = 1024;
const clamp = value => Math.min(1, Math.max(0, value));

function smoothstep(low, high, value) {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

function hash(x, y, seed) {
  let n = Math.imul(x + 1, 0x1b873593) ^ Math.imul(y + 1, 0x85ebca6b) ^ Math.imul(seed, 0xc2b2ae35);
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function tileNoise(frequency, seed) {
  const cells = Math.max(2, Math.round(frequency * clayTileMillimeters));
  const grid = Float32Array.from({ length: cells * cells }, (_, index) =>
    hash(index % cells, Math.floor(index / cells), seed));
  const lows = new Uint32Array(resolution);
  const highs = new Uint32Array(resolution);
  const weights = new Float32Array(resolution);
  for (let i = 0; i < resolution; i++) {
    const point = (i + 0.5) * cells / resolution;
    lows[i] = Math.floor(point);
    highs[i] = (lows[i] + 1) % cells;
    weights[i] = smoothstep(0, 1, point - lows[i]);
  }
  return (x, y) => {
    const a = lows[y] * cells;
    const b = highs[y] * cells;
    const t = weights[x];
    const near = grid[a + lows[x]] + (grid[a + highs[x]] - grid[a + lows[x]]) * t;
    const far = grid[b + lows[x]] + (grid[b + highs[x]] - grid[b + lows[x]]) * t;
    return near + (far - near) * weights[y];
  };
}

function tileFlecks(density) {
  const cells = Math.round(clayFrequencies.fleck * clayTileMillimeters);
  return (x, y) => {
    const u = (x + 0.5) * cells / resolution;
    const v = (y + 0.5) * cells / resolution;
    const ix = Math.floor(u);
    const iy = Math.floor(v);
    if (hash(ix, iy, 19) < 1 - density) return 0;
    const centerX = 0.26 + 0.48 * hash(ix, iy, 1);
    const centerY = 0.26 + 0.48 * hash(ix, iy, 2);
    const radius = 0.13 + 0.13 * hash(ix, iy, 7);
    return 1 - smoothstep(radius - 0.065, radius, Math.hypot(u - ix - centerX, v - iy - centerY));
  };
}

function srgbByte(linear) {
  return 255 * clamp(linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055);
}

export function bakeClayTextures(finish) {
  const pixels = resolution * resolution;
  const color = new Uint8ClampedArray(pixels * 3);
  const roughness = new Uint8ClampedArray(pixels);
  const heights = new Float32Array(pixels);
  const variationAt = tileNoise(clayFrequencies.variation, 1);
  const grainAt = tileNoise(clayFrequencies.grain, 2);
  const aggregateAt = tileNoise(clayFrequencies.aggregate, 3);
  const poresAt = tileNoise(clayFrequencies.pores, 4);
  const gritAt = tileNoise(clayFrequencies.grit, 5);
  const fleckAt = tileFlecks(finish.density ?? 0);
  const base = new Color(finish.color);
  const fleckColor = new Color(finish.fleck ?? finish.color);

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const i = y * resolution + x;
      const pixel = i * 3;
      const variation = variationAt(x, y) - 0.5;
      const grain = grainAt(x, y) - 0.5;
      const aggregate = aggregateAt(x, y) - 0.5;
      const pores = smoothstep(0.12, 0.32, poresAt(x, y)) - 1;
      const grit = gritAt(x, y) - 0.5;
      const fleck = fleckAt(x, y);
      const tone = 1 + finish.grain * (2 * variation + 2.7 * grain + 0.8 * aggregate + 0.82 * pores + 0.36 * grit);
      color[pixel] = srgbByte(base.r * tone * (1 - fleck) + fleckColor.r * fleck);
      color[pixel + 1] = srgbByte(base.g * tone * (1 - fleck) + fleckColor.g * fleck);
      color[pixel + 2] = srgbByte(base.b * tone * (1 - fleck) + fleckColor.b * fleck);
      roughness[i] = 255 * Math.max(0.35, clamp(finish.roughness + finish.grain *
        (2.4 * grain + 0.8 * aggregate - 0.7 * pores + 0.35 * grit)));
      heights[i] = finish.grain * (grain + 0.22 * variation + 0.28 * aggregate + 0.32 * pores + 0.11 * grit);
    }
  }

  const normal = new Uint8ClampedArray(pixels * 3);
  const bump = new Uint8ClampedArray(pixels);
  const slopeScale = resolution / (2 * clayTileMillimeters);
  const bumpAmplitude = 2 * Math.max(finish.grain, 1e-6);
  for (let y = 0; y < resolution; y++) {
    const previous = (y + resolution - 1) % resolution * resolution;
    const next = (y + 1) % resolution * resolution;
    const row = y * resolution;
    for (let x = 0; x < resolution; x++) {
      const i = row + x;
      const dx = (heights[row + (x + resolution - 1) % resolution] - heights[row + (x + 1) % resolution]) * slopeScale;
      // PNG rows increase downward, while the OBJ's V coordinate increases upward.
      const dy = (heights[next + x] - heights[previous + x]) * slopeScale;
      const invLength = 1 / Math.hypot(dx, dy, 1);
      const pixel = i * 3;
      normal[pixel] = 127.5 * (1 + dx * invLength);
      normal[pixel + 1] = 127.5 * (1 + dy * invLength);
      normal[pixel + 2] = 127.5 * (1 + invLength);
      bump[i] = 255 * clamp(0.5 + heights[i] / bumpAmplitude);
    }
  }

  return {
    'clay-color.png': encodeTexturePng(color, resolution, 3),
    'clay-roughness.png': encodeTexturePng(roughness, resolution, 1),
    'clay-normal.png': encodeTexturePng(normal, resolution, 3),
    'clay-bump.png': encodeTexturePng(bump, resolution, 1),
  };
}
