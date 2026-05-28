import { describe, expect, it } from 'vitest';
import { nearestPaletteColor, pixelizeRgbaPixels } from '../src/lib/imagePixelizer';

function solidRgba(width: number, height: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  }
  return data;
}

describe('imagePixelizer', () => {
  it('fits the whole source image inside the target canvas without cropping', () => {
    const result = pixelizeRgbaPixels({
      sourceWidth: 2,
      sourceHeight: 4,
      data: solidRgba(2, 4, [239, 68, 68, 255]),
      targetWidth: 4,
      targetHeight: 4,
      defaultColorHex: '#FFFFFF',
      palette: ['#FFFFFF', '#EF4444']
    });

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(result.pixels).toHaveLength(8);
    expect(result.pixels.every((pixel) => pixel.x === 1 || pixel.x === 2)).toBe(true);
    expect(result.pixels.every((pixel) => pixel.colorHex === '#EF4444')).toBe(true);
  });

  it('keeps transparent source pixels as the default background color', () => {
    const result = pixelizeRgbaPixels({
      sourceWidth: 1,
      sourceHeight: 1,
      data: solidRgba(1, 1, [34, 197, 94, 0]),
      targetWidth: 2,
      targetHeight: 2,
      defaultColorHex: '#FFFFFF',
      palette: ['#FFFFFF', '#22C55E']
    });

    expect(result.pixels).toEqual([]);
  });

  it('maps source colors to the nearest Pixel World palette color', () => {
    expect(nearestPaletteColor({ r: 33, g: 198, b: 96 }, ['#FFFFFF', '#22C55E', '#38BDF8'])).toBe('#22C55E');
  });
});
