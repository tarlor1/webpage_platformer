import png from '../assets/coin.png';
import { createSpriteRenderer } from './sprite';

export const COIN_SPRITE = {
  png,
  frame: { x: 0, y: 0, width: 8, height: 8 },
  scale: 2,
  facing: 1 as const,
};

export const COIN_HEIGHT = COIN_SPRITE.frame.height * COIN_SPRITE.scale;
export const coinSprite = createSpriteRenderer(COIN_SPRITE);
