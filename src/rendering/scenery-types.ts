export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  kind?: 'text' | 'media' | 'control' | 'pending';
  element?: Element;
  /** Protection expansion outside the visible native bounds, in document pixels. */
  padding?: number;
}
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
  logicalKey: string;
  x: number;
  /** Texture top in document pixels; its center is the native collision edge. */
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface Shopkeeper {
  placementId: string;
}

export interface SceneryScene {
  placements: SceneryPlacement[];
  protectedRects: readonly Rect[];
  reserved?: Rect;
  shopkeeper?: Shopkeeper;
  ready: boolean;
}
