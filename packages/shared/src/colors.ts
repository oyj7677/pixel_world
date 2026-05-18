export type HexColor = `#${string}`;

export const DEFAULT_CANVAS_COLOR: HexColor = '#FFFFFF';

export const DEFAULT_PALETTE: HexColor[] = [
  '#FFFFFF',
  '#E2E8F0',
  '#0F172A',
  '#EF4444',
  '#F97316',
  '#FACC15',
  '#22C55E',
  '#14B8A6',
  '#06B6D4',
  '#38BDF8',
  '#3B82F6',
  '#6366F1',
  '#8B5CF6',
  '#D946EF',
  '#F472B6',
  '#FB7185'
];

const HEX_6 = /^[0-9a-fA-F]{6}$/;
const HEX_3 = /^[0-9a-fA-F]{3}$/;

export function normalizeHexColor(input: string): HexColor | null {
  const raw = input.trim().replace(/^#/, '');

  if (HEX_6.test(raw)) {
    return `#${raw.toUpperCase()}`;
  }

  if (HEX_3.test(raw)) {
    const expanded = raw
      .split('')
      .map((char) => `${char}${char}`)
      .join('')
      .toUpperCase();
    return `#${expanded}`;
  }

  return null;
}

export function hexToRgb(color: HexColor): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    throw new Error(`Invalid HEX color: ${color}`);
  }

  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16)
  };
}
