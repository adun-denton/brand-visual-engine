export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Image coordinates use the encoded top-left. The displayed image rect includes zoom/letterboxing. */
export function normalizedPoint(
  clientX: number,
  clientY: number,
  image: Box,
): { x: number; y: number } | null {
  if (image.width <= 0 || image.height <= 0) return null;
  const x = (clientX - image.x) / image.width,
    y = (clientY - image.y) / image.height;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}
export function regionBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
