/** Measured webpage top edge. Previous bounds describe the last simulated frame. */
export interface Platform {
  id: string;
  /** Stable content identity shared by wrapped segments and visual clones. */
  logicalKey?: string;
  /** A recycled/looped surface has no continuous path between these endpoints. */
  discontinuous?: boolean;
  /** Layout moved this top without a physical path; existing riders still follow it. */
  reflow?: boolean;
  x: number;
  y: number;
  width: number;
  label?: string;
  moving?: boolean;
  previousX?: number;
  previousY?: number;
  previousWidth?: number;
}
export interface Body { x: number; y: number; width: number; height: number; vx: number; vy: number; grounded: boolean; platformId?: string }
export interface Level { platforms: Platform[]; spawn?: { x: number; y: number } }
export const MOTION = { speed: 240, jump: 620, gravity: 1600, width: 22, height: 30, step: 1 / 120 } as const;
export const OVERLAY_ID = 'steel-steam-overlay';
