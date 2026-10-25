import png from '../assets/grass.png';
import { createSpriteRenderer } from './sprite';

export const GRASS_SPRITE = {
  png,
  frame: { x: 0, y: 5, width: 16, height: 5 },
  scale: 2,
  facing: 1 as const,
};

export const grassSprite = createSpriteRenderer(GRASS_SPRITE);
