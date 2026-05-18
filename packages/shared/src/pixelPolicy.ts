export const DEFAULT_CANVAS_ID = 'global';
export const DEFAULT_CANVAS_WIDTH = 100;
export const DEFAULT_CANVAS_HEIGHT = 100;
export const DEFAULT_COOLDOWN_MS = 10000;
export const OVERWRITE_POLICY_ALWAYS = 'always' as const;

export type OverwritePolicy = typeof OVERWRITE_POLICY_ALWAYS;

export interface PixelPolicy {
  canvasId: string;
  width: number;
  height: number;
  cooldownMs: number;
  overwritePolicy: OverwritePolicy;
}

export function createPixelPolicy(overrides: Partial<PixelPolicy> = {}): PixelPolicy {
  return {
    canvasId: DEFAULT_CANVAS_ID,
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    overwritePolicy: OVERWRITE_POLICY_ALWAYS,
    ...overrides
  };
}

export type CoordinateValidationResult =
  | { ok: true }
  | { ok: false; reason: 'x_out_of_bounds' | 'y_out_of_bounds' | 'not_integer' };

export function validateCoordinate(policy: PixelPolicy, x: number, y: number): CoordinateValidationResult {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return { ok: false, reason: 'not_integer' };
  }

  if (x < 0 || x >= policy.width) {
    return { ok: false, reason: 'x_out_of_bounds' };
  }

  if (y < 0 || y >= policy.height) {
    return { ok: false, reason: 'y_out_of_bounds' };
  }

  return { ok: true };
}
