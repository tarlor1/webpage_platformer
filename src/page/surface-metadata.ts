import type { Platform } from '../engine/types';

/** DOM ownership stays outside the reusable numeric physics contract. */
export interface SurfaceMetadata { element: Element; text: boolean }
const metadata = new WeakMap<Platform, SurfaceMetadata>();

export function setSurfaceMetadata(platform: Platform, element: Element, text: boolean): void {
  const current = metadata.get(platform);
  if (current) { current.element = element; current.text = text; }
  else metadata.set(platform, { element, text });
}

export function surfaceMetadata(platform: Platform): SurfaceMetadata | undefined {
  return metadata.get(platform);
}
