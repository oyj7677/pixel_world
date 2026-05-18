import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CANVAS_ID,
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_COOLDOWN_MS,
  createPixelPolicy,
  validateCoordinate
} from '../src/pixelPolicy';

describe('pixel policy constants', () => {
  it('matches the approved MVP values', () => {
    expect(DEFAULT_CANVAS_ID).toBe('global');
    expect(DEFAULT_CANVAS_WIDTH).toBe(100);
    expect(DEFAULT_CANVAS_HEIGHT).toBe(100);
    expect(DEFAULT_COOLDOWN_MS).toBe(10000);
  });
});

describe('validateCoordinate', () => {
  const policy = createPixelPolicy();

  it('accepts coordinates inside the canvas', () => {
    expect(validateCoordinate(policy, 0, 0)).toEqual({ ok: true });
    expect(validateCoordinate(policy, 99, 99)).toEqual({ ok: true });
  });

  it('rejects coordinates outside the canvas', () => {
    expect(validateCoordinate(policy, -1, 0)).toEqual({ ok: false, reason: 'x_out_of_bounds' });
    expect(validateCoordinate(policy, 0, 100)).toEqual({ ok: false, reason: 'y_out_of_bounds' });
  });
});
