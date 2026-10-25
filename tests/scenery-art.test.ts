import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawScenery, sceneryDesigns } from '../src/rendering/scenery-art';
import { pageSeedKey } from '../src/page/page-identity';
import { placeScenery } from '../src/rendering/scenery';
import type { SceneryDesign } from '../src/rendering/scenery-types';

const PAGE = 'https://example.com:8443/article?mode=steam&tag=brass&tag=steel#engine';

test('page identity ignores protocol, unknown queries, fragments, and tracking on the same path', () => {
  const equivalent = 'http://example.com:8443/article?tag=steel&utm_source=news&mode=steam'
    + '&gclid=ads&tag=brass&fbclid=social&UTM_CAMPAIGN=launch&msclkid=click'
    + '&dclid=display&gbraid=ad&wbraid=ad&yclid=ad&igshid=social&mc_cid=mail'
    + '&mc_eid=mail&_ga=analytics&_gl=analytics&srsltid=shop#engine';
  assert.equal(pageSeedKey(equivalent), pageSeedKey(PAGE));
  assert.deepEqual(sceneryDesigns(equivalent), sceneryDesigns(PAGE));
  assert.equal(pageSeedKey('https://EXAMPLE.com/one'), pageSeedKey('http://example.com/one'));
  assert.equal(pageSeedKey('https://example.com/?q=steam+engine'),
    pageSeedKey('https://example.com/?q=steam%20engine'));
});

test('host, port and meaningful pathname remain identity boundaries', () => {
  const variants = [
    PAGE.replace('example.com', 'other.example.com'),
    PAGE.replace(':8443', ':8444'),
    PAGE.replace('/article', '/Article'),
    PAGE.replace('/article', '/article/'),
    PAGE.replace('/article', '/other'),
  ];
  for (const url of variants) {
    assert.notEqual(pageSeedKey(url), pageSeedKey(PAGE));
    assert.notDeepEqual(sceneryDesigns(url), sceneryDesigns(PAGE));
  }
});

test('seed keys do not conflate query delimiters with encoded values', () => {
  assert.notEqual(pageSeedKey('https://www.google.com/search?q=b%26start%3D20'),
    pageSeedKey('https://www.google.com/search?q=b&start=20'));
});

test('the same URL reproduces the same decoration identities and attributes', () => {
  assert.deepEqual(sceneryDesigns(PAGE), sceneryDesigns(PAGE));
});

test('surface decorations remain thin instead of becoming page backgrounds', () => {
  for (let index = 0; index < 100; index++) {
    for (const design of sceneryDesigns(`https://example.com/edition/${index}`)) {
      assert.ok(design.height > 0 && design.height <= 12);
      assert.ok(design.width >= 30);
    }
  }
});

test('URL variation changes actual artwork attributes, not only design IDs', () => {
  const appearances = Array.from({ length: 20 }, (_, edition) =>
    sceneryDesigns(`https://example.com/edition/${edition}`).map(({ id, rank, ...appearance }) => appearance));
  assert.ok(new Set(appearances.map(appearance => JSON.stringify(appearance))).size > 1);
});

test('Google tracking timestamps do not change query-specific decoration designs', () => {
  const base = 'https://www.google.com/search?q=steam+engine#results';
  const tracked = `${base.replace('#results', '')}&sei=time-one&ei=time-two&zx=cache-buster&ved=click&sourceid=chrome#results`;
  assert.deepEqual(sceneryDesigns(base), sceneryDesigns(tracked));
  assert.notDeepEqual(sceneryDesigns(base), sceneryDesigns(base.replace('steam+engine', 'brass+gears')));
  assert.equal(pageSeedKey('https://example.com/?source=one'), pageSeedKey('https://example.com/?source=two'));
  assert.equal(pageSeedKey('https://example.com/?zx=one'), pageSeedKey('https://example.com/?zx=two'));
});

function artContext(): { ctx: CanvasRenderingContext2D; draws: number[][]; pixels: { color: string; rect: number[] }[] } {
  const draws: number[][] = [], pixels: { color: string; rect: number[] }[] = [];
  const paint = {
    fillStyle: '',
    fillRect(...rect: number[]) { pixels.push({ color: this.fillStyle, rect }); },
  };
  const texture = { width: 0, height: 0, getContext: () => paint };
  const ctx = {
    canvas: { ownerDocument: { createElement: () => texture } },
    drawImage(_image: unknown, ...coordinates: number[]) { draws.push(coordinates); },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, draws, pixels };
}

test('full native edges tile the existing texture without stretching or truncating long surfaces', () => {
  const design: SceneryDesign = { id: 'native-rail', kind: 'rail', width: 480, height: 10, palette: 0, variant: 1, rank: 42 };
  for (const width of [1, 12, 29, 107, 480, 1205]) {
    const { ctx, draws } = artContext();
    const placements = placeScenery([{ ...design }], [{ id: `edge-${width}`, x: 20, y: 100, width }]);
    drawScenery(ctx, placements);
    assert.equal(draws.reduce((sum, draw) => sum + draw[6], 0), width);
    let end = 20;
    for (const [sx, sy, sw, sh, dx, dy, dw, dh] of draws) {
      assert.equal(sx, 0);
      assert.equal(sy, 0);
      assert.equal(sw, dw);
      assert.equal(sh, dh);
      assert.equal(sh, 10);
      assert.ok(sw <= design.width);
      assert.equal(dx, end);
      assert.equal(dy, 95);
      end += dw;
    }
    assert.equal(end, 20 + width);
    assert.equal(draws.length, Math.ceil(width / design.width));
  }
});

test('tiling preserves the original rail colors, four-pixel sleepers and native pitch', () => {
  const { ctx, pixels } = artContext();
  const design: SceneryDesign = { id: 'original-rail', kind: 'rail', width: 480, height: 10, palette: 0, variant: 1, rank: 42 };
  drawScenery(ctx, placeScenery([design], [{ id: 'long-rail', x: 0, y: 100, width: 1500 }]));
  const sleepers = pixels.filter(pixel => pixel.color === '#80542f');
  assert.deepEqual(sleepers[0].rect, [1, 0, 4, 10]);
  assert.deepEqual(sleepers[1].rect, [21, 0, 4, 10]);
  assert.ok(sleepers.every(pixel => pixel.rect[2] === 4 && pixel.rect[3] === 10));
  assert.deepEqual(pixels.filter(pixel => pixel.color === '#bcc6ce').map(pixel => pixel.rect), [[0, 1, 480, 2], [0, 7, 480, 2]]);
  assert.deepEqual(pixels.filter(pixel => pixel.color === '#edf1f3').map(pixel => pixel.rect), [[0, 1, 480, 1], [0, 7, 480, 1]]);
});

test('tiling preserves the original road colors and eleven-by-two markings at native pitch', () => {
  const { ctx, pixels } = artContext();
  const design: SceneryDesign = { id: 'original-road', kind: 'road', width: 480, height: 10, palette: 0, variant: 3, rank: 42 };
  drawScenery(ctx, placeScenery([design], [{ id: 'long-road', x: 0, y: 100, width: 1500 }]));
  assert.deepEqual(pixels.find(pixel => pixel.color === '#505c64')!.rect, [0, 0, 480, 10]);
  assert.deepEqual(pixels.filter(pixel => pixel.color === '#a9b3b3').map(pixel => pixel.rect), [[0, 0, 480, 1], [0, 9, 480, 1]]);
  const markings = pixels.filter(pixel => pixel.color === '#e5c776');
  assert.deepEqual(markings[0].rect, [3, 4, 11, 2]);
  assert.deepEqual(markings[1].rect, [27, 4, 11, 2]);
  assert.ok(markings.every(pixel => pixel.rect[2] === 11 && pixel.rect[3] === 2));
});

test('camera culling keeps the texture phase anchored to the full native edge', () => {
  const values = { scrollX: 610, scrollY: 0, innerWidth: 300, innerHeight: 700 };
  const descriptors = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
  try {
    const design: SceneryDesign = { id: 'camera-rail', kind: 'rail', width: 480, height: 10, palette: 0, variant: 1, rank: 42 };
    const placements = placeScenery([design], [{ id: 'camera-edge', x: 20, y: 100, width: 1205 }]);
    const first = artContext();
    drawScenery(first.ctx, placements);
    assert.deepEqual(first.draws.map(draw => draw[4]), [500]);
    Object.defineProperty(globalThis, 'scrollX', { value: 720, configurable: true });
    const next = artContext();
    drawScenery(next.ctx, placements);
    assert.deepEqual(next.draws.map(draw => draw[4]), [500, 980]);
    assert.deepEqual(next.draws.map(draw => draw[6]), [480, 245]);
    assert.ok(next.draws.every(draw => draw[2] === draw[6] && draw[3] === draw[7]));
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
