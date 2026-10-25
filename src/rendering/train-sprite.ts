import png from '../assets/train.png';
import { createSpriteRenderer } from './sprite';

export const TRAIN_SPRITE = {
  png,
  frame: { x: 0, y: 0, width: 32, height: 32 },
  scale: 2,
  facing: -1 as const,
};

export const TRAIN_WIDTH = TRAIN_SPRITE.frame.width * TRAIN_SPRITE.scale;
export const trainSprite = createSpriteRenderer(TRAIN_SPRITE);
