import {
  DEFAULT_CANVAS_COLOR,
  DEFAULT_PALETTE,
  hexToRgb,
  normalizeHexColor,
  type HexColor,
  type RoomPixelTemplatePixelDto,
  type SaveRoomPixelTemplateRequestDto
} from '@pixel-world/shared';

export interface PixelizeRgbaPixelsInput {
  sourceWidth: number;
  sourceHeight: number;
  data: Uint8ClampedArray;
  targetWidth: number;
  targetHeight: number;
  defaultColorHex?: HexColor | undefined;
  palette?: HexColor[] | undefined;
  alphaThreshold?: number | undefined;
}

export type PixelizedTemplateDraft = SaveRoomPixelTemplateRequestDto;

function squaredDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

export function nearestPaletteColor(color: { r: number; g: number; b: number }, palette: HexColor[] = DEFAULT_PALETTE): HexColor {
  const [firstColor = DEFAULT_CANVAS_COLOR] = palette;
  let closestColor = normalizeHexColor(firstColor) ?? DEFAULT_CANVAS_COLOR;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const paletteColor of palette) {
    const normalizedPaletteColor = normalizeHexColor(paletteColor);
    if (!normalizedPaletteColor) {
      continue;
    }

    const distance = squaredDistance(color, hexToRgb(normalizedPaletteColor));
    if (distance < closestDistance) {
      closestDistance = distance;
      closestColor = normalizedPaletteColor;
    }
  }

  return closestColor;
}

function containBox(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;

  if (sourceRatio > targetRatio) {
    const width = targetWidth;
    const height = Math.max(1, Math.round(targetWidth / sourceRatio));
    return {
      x: 0,
      y: Math.floor((targetHeight - height) / 2),
      width,
      height,
    };
  }

  const height = targetHeight;
  const width = Math.max(1, Math.round(targetHeight * sourceRatio));
  return {
    x: Math.floor((targetWidth - width) / 2),
    y: 0,
    width,
    height,
  };
}

export function pixelizeRgbaPixels(input: PixelizeRgbaPixelsInput): PixelizedTemplateDraft {
  const defaultColorHex = normalizeHexColor(input.defaultColorHex ?? DEFAULT_CANVAS_COLOR) ?? DEFAULT_CANVAS_COLOR;
  const palette = input.palette ?? DEFAULT_PALETTE;
  const alphaThreshold = input.alphaThreshold ?? 16;
  const box = containBox(input.sourceWidth, input.sourceHeight, input.targetWidth, input.targetHeight);
  const pixels: RoomPixelTemplatePixelDto[] = [];

  for (let y = 0; y < input.targetHeight; y += 1) {
    for (let x = 0; x < input.targetWidth; x += 1) {
      if (x < box.x || x >= box.x + box.width || y < box.y || y >= box.y + box.height) {
        continue;
      }

      const sourceX = Math.min(
        input.sourceWidth - 1,
        Math.floor(((x - box.x + 0.5) * input.sourceWidth) / box.width)
      );
      const sourceY = Math.min(
        input.sourceHeight - 1,
        Math.floor(((y - box.y + 0.5) * input.sourceHeight) / box.height)
      );
      const offset = (sourceY * input.sourceWidth + sourceX) * 4;
      const alpha = input.data[offset + 3] ?? 255;
      if (alpha < alphaThreshold) {
        continue;
      }

      const colorHex = nearestPaletteColor({
        r: input.data[offset] ?? 0,
        g: input.data[offset + 1] ?? 0,
        b: input.data[offset + 2] ?? 0,
      }, palette);
      if (colorHex !== defaultColorHex) {
        pixels.push({ x, y, colorHex });
      }
    }
  }

  return {
    width: input.targetWidth,
    height: input.targetHeight,
    defaultColorHex,
    pixels,
  };
}

export async function pixelizeImageFile(
  file: File,
  options: {
    targetWidth: number;
    targetHeight: number;
    defaultColorHex?: HexColor;
    palette?: HexColor[];
  },
): Promise<PixelizedTemplateDraft> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('canvas_context_unavailable');
    }

    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);

    return pixelizeRgbaPixels({
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      data: imageData.data,
      targetWidth: options.targetWidth,
      targetHeight: options.targetHeight,
      defaultColorHex: options.defaultColorHex,
      palette: options.palette,
    });
  } finally {
    bitmap.close();
  }
}
