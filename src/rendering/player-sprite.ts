import playerPNG from '../assets/player.png';
import { createSpriteRenderer, type SpriteDefinition } from './sprite';

/** Swap the PNG and adjust this definition to insert another player sprite. */
export const PLAYER_SPRITE: SpriteDefinition = {
  png: playerPNG,
  frame: { x: 1, y: 1, width: 14, height: 15 },
  scale: 2,
  facing: 1,
  outline: true,
};

export const playerSprite = createSpriteRenderer(PLAYER_SPRITE);
