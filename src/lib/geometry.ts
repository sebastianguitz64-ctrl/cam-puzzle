export type Point = {
  x: number;
  y: number;
};

export type Region = {
  x: number;
  y: number;
  width: number;
  height: number;
  center: Point;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function toPixel(point: Point, width: number, height: number): Point {
  return {
    x: point.x * width,
    y: point.y * height,
  };
}

export function getMidpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

export function getRegionFromPinch(
  center: Point,
  distanceNormalized: number,
  width: number,
  height: number,
): Region {
  const side = clamp(
    Math.min(width, height) * (0.22 + distanceNormalized * 1.8),
    90,
    Math.min(width, height) * 0.8,
  );

  const x = clamp(center.x - side / 2, 0, width - side);
  const y = clamp(center.y - side / 2, 0, height - side);

  return {
    x,
    y,
    width: side,
    height: side,
    center,
  };
}
