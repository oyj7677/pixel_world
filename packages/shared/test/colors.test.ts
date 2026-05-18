import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE, hexToRgb, normalizeHexColor } from '../src/colors';

describe('normalizeHexColor', () => {
  it('normalizes valid 6-digit colors to uppercase with leading hash', () => {
    expect(normalizeHexColor('#38bdf8')).toBe('#38BDF8');
    expect(normalizeHexColor('ef4444')).toBe('#EF4444');
  });

  it('expands valid 3-digit colors', () => {
    expect(normalizeHexColor('#0af')).toBe('#00AAFF');
  });

  it('rejects invalid colors', () => {
    expect(normalizeHexColor('blue')).toBeNull();
    expect(normalizeHexColor('#12')).toBeNull();
    expect(normalizeHexColor('#xyzxyz')).toBeNull();
  });
});

describe('hexToRgb', () => {
  it('converts normalized hex to rgb channels', () => {
    expect(hexToRgb('#38BDF8')).toEqual({ r: 56, g: 189, b: 248 });
  });
});

describe('DEFAULT_PALETTE', () => {
  it('contains normalized unique colors', () => {
    expect(DEFAULT_PALETTE.length).toBeGreaterThanOrEqual(16);
    expect(new Set(DEFAULT_PALETTE).size).toBe(DEFAULT_PALETTE.length);
    expect(DEFAULT_PALETTE.every((color) => color === normalizeHexColor(color))).toBe(true);
  });
});
