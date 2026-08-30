export const LIVELINE_W = 320;
export const LIVELINE_H = 84;

export type LivelinePt = {
  x: number;
  y: number;
  value: number;
  index: number;
};

export function livelinePoints(
  values: number[],
  width = LIVELINE_W,
  height = LIVELINE_H,
): { min: number; max: number; pts: LivelinePt[] } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const last = Math.max(values.length - 1, 1);
  const pts = values.map((value, index) => {
    const x = (index / last) * (width - 8) + 4;
    const y = height - 8 - ((value - min) / span) * (height - 16);
    return { x, y, value, index };
  });
  return { min, max, pts };
}

export function livelineIndexAt(x: number, count: number, width = LIVELINE_W): number {
  if (count <= 1) return 0;
  const t = (x - 4) / (width - 8);
  const index = Math.round(t * (count - 1));
  return Math.max(0, Math.min(count - 1, index));
}

export function livelineViewX(clientX: number, box: { left: number; width: number }, width = LIVELINE_W): number {
  if (box.width <= 0) return 0;
  return ((clientX - box.left) / box.width) * width;
}
