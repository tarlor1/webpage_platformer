import type { SceneryDesign, SceneryPlacement } from './scenery-types';
import { pageSeedKey } from '../page/page-identity';
import { railSprite, RAIL_SPRITE } from './rail-sprite';
import { grassSprite, GRASS_SPRITE } from './grass-sprite';

const VERSION = 3;
const KINDS: readonly SceneryDesign['kind'][] = ['rail', 'road'];
const PALETTES = [
  { rail: '#bcc6ce', sleeper: '#80542f', road: '#505c64', marking: '#e5c776' },
  { rail: '#c4cdd4', sleeper: '#765036', road: '#59636a', marking: '#eddbac' },
  { rail: '#b7c1ca', sleeper: '#8b5d36', road: '#46545e', marking: '#dbc382' },
] as const;
const textures = new WeakMap<SceneryDesign, HTMLCanvasElement>();

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  }
  return result >>> 0;
}

/** URL-seeded rail/grass materials. The internal road kind now uses grass artwork. */
export function sceneryDesigns(url: string): SceneryDesign[] {
  const seed = hash(`scenery:${VERSION}:${pageSeedKey(url)}`);
  let state = seed;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
  const offset = next() % KINDS.length;
  return Array.from({ length: 6 }, (_, index) => ({
    id: `scenery-v${VERSION}-${seed.toString(16)}-${index}`,
    kind: KINDS[(index + offset) % KINDS.length]!,
    width: 480,
    height: KINDS[(index + offset) % KINDS.length] === 'road' ? GRASS_SPRITE.frame.height * GRASS_SPRITE.scale : 10,
    surfaceOffset: KINDS[(index + offset) % KINDS.length] === 'road' ? 2 : 5,
    palette: next() % PALETTES.length,
    variant: next() % 8,
    rank: next(),
  }));
}

function textureFor(ctx: CanvasRenderingContext2D, design: SceneryDesign): HTMLCanvasElement {
  const cached = textures.get(design);
  if (cached) return cached;
  const canvas = ctx.canvas.ownerDocument.createElement('canvas');
  canvas.width = design.width;
  canvas.height = design.height;
  const paint = canvas.getContext('2d')!;
  paint.imageSmoothingEnabled = false;
  const palette = PALETTES[design.palette];
  const rail = design.kind === 'rail';
  const definition = rail ? RAIL_SPRITE : GRASS_SPRITE;
  const sprite = rail ? railSprite : grassSprite;
  const tileWidth = definition.frame.width * definition.scale;
  const tileHeight = definition.frame.height * definition.scale;
  for (let x = 0; x < design.width; x += tileWidth) {
    if (!sprite.draw(paint, x + tileWidth / 2, design.height / 2 + tileHeight / 2, 1)) {
      // Keep platforms visible during the asynchronous image decode. Do not cache this placeholder.
      paint.fillStyle = rail ? palette.rail : '#719d45';
      paint.fillRect(0, 1, design.width, 1);
      paint.fillRect(0, design.height - 2, design.width, 1);
      return canvas;
    }
  }
  textures.set(design, canvas);
  return canvas;
}

/** Tile the original artwork at native scale; eligibility already guarantees a clean strip. */
export function drawScenery(ctx: CanvasRenderingContext2D, placements: readonly SceneryPlacement[]): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const placement of placements) {
    if (!placement.visible) continue;
    const { design, x, y, width, height } = placement;
    if (width <= 0 || height <= 0) continue;
    const texture = textureFor(ctx, design);
    const sx = typeof scrollX === 'number' ? scrollX : x;
    const right = typeof innerWidth === 'number' ? sx + innerWidth : x + width;
    const first = Math.max(0, Math.floor((sx - x) / design.width));
    const end = Math.min(width, right - x);
    for (let offset = first * design.width; offset < end; offset += design.width) {
      const tileWidth = Math.min(design.width, width - offset);
      ctx.drawImage(texture, 0, 0, tileWidth, height, x + offset, y, tileWidth, height);
    }
  }
  ctx.restore();
}
