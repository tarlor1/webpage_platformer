export interface SpriteDefinition {
  png: Uint8Array<ArrayBuffer>;
  /** Source rectangle in the PNG. Omit to use the entire image. */
  frame?: { x: number; y: number; width: number; height: number };
  /** Integer scaling keeps pixel art crisp. */
  scale: number;
  /** Direction the original artwork faces, before mirroring. */
  facing: 1 | -1;
  outline?: boolean;
}

/** Decode and prepare once; subsequent frames only draw the cached sprite. */
export function createSpriteRenderer(definition: SpriteDefinition) {
  if (!Number.isInteger(definition.scale) || definition.scale < 1) throw new Error('Sprite scale must be a positive integer.');
  let started = false;
  let sprite: HTMLCanvasElement | undefined;
  const padding = definition.outline ? 2 : 0;

  async function load(): Promise<void> {
    const bitmap = await createImageBitmap(new Blob([definition.png], { type: 'image/png' }));
    try {
      const frame = definition.frame ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
      const width = frame.width * definition.scale, height = frame.height * definition.scale;
      const image = document.createElement('canvas');
      image.width = width; image.height = height;
      const imageContext = image.getContext('2d')!;
      imageContext.imageSmoothingEnabled = false;
      imageContext.drawImage(bitmap, frame.x, frame.y, frame.width, frame.height, 0, 0, width, height);

      const result = document.createElement('canvas');
      result.width = width + padding * 2; result.height = height + padding * 2;
      const ctx = result.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      if (definition.outline) {
        const mask = document.createElement('canvas');
        mask.width = width; mask.height = height;
        const maskContext = mask.getContext('2d')!;
        for (const [radius, color] of [[2, '#15212b'], [1, '#fff4d6']] as const) {
          maskContext.clearRect(0, 0, width, height);
          maskContext.globalCompositeOperation = 'source-over';
          maskContext.drawImage(image, 0, 0);
          maskContext.globalCompositeOperation = 'source-in';
          maskContext.fillStyle = color;
          maskContext.fillRect(0, 0, width, height);
          for (const dx of [-radius, 0, radius]) for (const dy of [-radius, 0, radius]) {
            if (dx || dy) ctx.drawImage(mask, padding + dx, padding + dy);
          }
        }
      }
      ctx.drawImage(image, padding, padding);
      sprite = result;
    } finally {
      bitmap.close();
    }
  }

  return {
    /** Position is the center of the character's feet. False means use a fallback while loading. */
    draw(ctx: CanvasRenderingContext2D, feetX: number, feetY: number, facing: number): boolean {
      if (!started && typeof createImageBitmap === 'function') {
        started = true;
        void load().catch(error => console.warn('Could not load sprite; using default player.', error));
      }
      if (!sprite) return false;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(Math.round(feetX), Math.round(feetY));
      ctx.scale((facing < 0 ? -1 : 1) === definition.facing ? 1 : -1, 1);
      ctx.drawImage(sprite, -sprite.width / 2, -sprite.height + padding);
      ctx.restore();
      return true;
    },
  };
}
