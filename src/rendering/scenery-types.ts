export interface Rect { x: number; y: number; width: number; height: number }
export interface SceneryDesign {
  id: string;
  kind: 'rail' | 'road';
  width: number;
  height: number;
  palette: number;
  variant: number;
  rank: number;
}
export interface SceneryPlacement {
  design: SceneryDesign;
  platformId: string;
  fraction: number;
  x: number;
  /** Texture top in document pixels; its center is the native collision edge. */
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface SceneryScene {
  placements: SceneryPlacement[];
  protectedRects: readonly Rect[];
  reserved?: Rect;
  ready: boolean;
}
