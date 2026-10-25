import png from '../assets/train-tracks.png';
import { createSpriteRenderer } from './sprite';

/** The track occupies four rows of the 16×16 PNG; repeat at the player's 2× scale. */
export const RAIL_SPRITE = {
  png,
  frame: { x: 0, y: 7, width: 16, height: 4 },
  scale: 2,
  facing: 1 as const,
};

export const railSprite = createSpriteRenderer(RAIL_SPRITE);
