export interface Platform { id: string; x: number; y: number; width: number; kind: 'dom' | 'bridge'; label?: string }
export interface Body { x: number; y: number; width: number; height: number; vx: number; vy: number; grounded: boolean; platformId?: string }
export interface Level { platforms: Platform[]; spawn: { x: number; y: number }; bounds: { left: number; right: number; top: number; bottom: number }; measured: number }
export const MOTION = { speed: 240, jump: 620, gravity: 1600, width: 22, height: 30, step: 1 / 120 } as const;
export const JUMP_HEIGHT = MOTION.jump * MOTION.jump / (2 * MOTION.gravity);
export const JUMP_REACH = MOTION.speed * 2 * MOTION.jump / MOTION.gravity;
export const OVERLAY_ID = 'steel-steam-overlay';
