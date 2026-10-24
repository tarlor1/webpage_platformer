import type { SceneryDesign, SceneryPlacement } from './scenery-types';
import { pageSeedKey } from './page-identity';

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

/** Six URL-seeded, thin native-edge track/road styles. */
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
    height: 10,
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
  const palette = PALETTES[design.palette];
  if (design.kind === 'rail') {
    paint.fillStyle = palette.sleeper;
    const pitch = [16, 20, 24][design.variant % 3];
    for (let x = design.variant; x < design.width; x += pitch) paint.fillRect(x, 0, 4, 10);
    paint.fillStyle = palette.rail;
    paint.fillRect(0, 1, design.width, 2);
    paint.fillRect(0, 7, design.width, 2);
    paint.fillStyle = '#edf1f3';
    paint.fillRect(0, 1, design.width, 1);
    paint.fillRect(0, 7, design.width, 1);
  } else {
    paint.fillStyle = palette.road;
    paint.fillRect(0, 0, design.width, 10);
    paint.fillStyle = '#a9b3b3';
    paint.fillRect(0, 0, design.width, 1);
    paint.fillRect(0, 9, design.width, 1);
    paint.fillStyle = palette.marking;
    for (let x = design.variant; x < design.width; x += 24) paint.fillRect(x, 4, 11, 2);
  }
  textures.set(design, canvas);
  return canvas;
}

/** Thin surface markings only; the renderer clips away all protected content. */
export function drawScenery(ctx: CanvasRenderingContext2D, placements: readonly SceneryPlacement[]): void {
  for (const placement of placements) {
    if (!placement.visible) continue;
    const { design, x, y, width, height } = placement;
    if (width <= 0 || height <= 0) continue;
    ctx.drawImage(textureFor(ctx, design), 0, 0, width, height, x, y, width, height);
  }
}
