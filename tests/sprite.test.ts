import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpriteRenderer } from '../src/rendering/sprite';

test('sprite loads once, crops at integer scale, anchors its feet, and mirrors without changing size', async () => {
  const originalDocument = globalThis.document;
  const originalDecode = globalThis.createImageBitmap;
  let decodes = 0, closed = false;
  const contexts: { imageSmoothingEnabled: boolean; drawImage: (...args: unknown[]) => void }[] = [];
  const canvases: { width: number; height: number; getContext: () => unknown }[] = [];
  const sourceDraws: unknown[][] = [];
  globalThis.createImageBitmap = (async () => {
    decodes++;
    return { width: 16, height: 16, close() { closed = true; } };
  }) as typeof createImageBitmap;
  globalThis.document = { createElement() {
    const context = { imageSmoothingEnabled: true, drawImage(...args: unknown[]) { sourceDraws.push(args); } };
    contexts.push(context);
    const canvas = { width: 0, height: 0, getContext: () => context };
    canvases.push(canvas);
    return canvas;
  } } as unknown as Document;
  try {
    const sprite = createSpriteRenderer({ png: new Uint8Array(), frame: { x: 1, y: 1, width: 14, height: 15 }, scale: 2, facing: 1 });
    const translations: number[][] = [], scales: number[][] = [], draws: unknown[][] = [];
    const ctx = { save() {}, restore() {}, imageSmoothingEnabled: true,
      translate(...args: number[]) { translations.push(args); },
      scale(...args: number[]) { scales.push(args); },
      drawImage(...args: unknown[]) { draws.push(args); },
    } as unknown as CanvasRenderingContext2D;
    assert.equal(sprite.draw(ctx, 11, 30, 1), false, 'fallback while decoding');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(sprite.draw(ctx, 11, 30, 1), true);
    assert.equal(sprite.draw(ctx, 11, 30, -1), true);
    assert.equal(decodes, 1);
    assert.equal(closed, true);
    assert.deepEqual(sourceDraws[0]!.slice(1), [1, 1, 14, 15, 0, 0, 28, 30]);
    assert.ok(contexts.every(context => !context.imageSmoothingEnabled));
    assert.equal(ctx.imageSmoothingEnabled, false);
    assert.deepEqual(translations, [[11, 30], [11, 30]]);
    assert.deepEqual(scales, [[1, 1], [-1, 1]]);
    assert.deepEqual(draws.map(draw => draw.slice(1)), [[-14, -30], [-14, -30]]);
    assert.deepEqual([canvases[1]!.width, canvases[1]!.height], [28, 30]);
  } finally {
    globalThis.document = originalDocument;
    globalThis.createImageBitmap = originalDecode;
  }
});
