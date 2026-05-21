import type { HexColor, PixelRecord } from '@pixel-world/shared';

export interface DownloadableCanvasImage {
  width: number;
  height: number;
  defaultColorHex: HexColor;
  pixels: Pick<PixelRecord, 'x' | 'y' | 'colorHex'>[];
}

interface DownloadCanvasImageOptions {
  roomName?: string | undefined;
  savedAt?: Date | string | undefined;
}

const DEFAULT_CELL_SCALE = 16;
const MAX_CANVAS_IMAGE_SIZE = 2048;

function sanitizeFilePart(value: string): string {
  const sanitized = value
    .trim()
    .replaceAll(/[^\p{L}\p{N}_-]+/gu, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 48);

  return sanitized || 'pixel-world';
}

function timestampFilePart(timestamp?: Date | string): string {
  const date = timestamp instanceof Date ? timestamp : timestamp ? new Date(timestamp) : new Date();
  const time = Number.isFinite(date.getTime()) ? date : new Date();

  return time.toISOString().replaceAll(/[:.]/g, '-');
}

function canvasImageScale(width: number, height: number): number {
  const largestDimension = Math.max(width, height);
  if (!Number.isFinite(largestDimension) || largestDimension <= 0) {
    return 1;
  }

  return Math.max(1, Math.min(DEFAULT_CELL_SCALE, Math.floor(MAX_CANVAS_IMAGE_SIZE / largestDimension)));
}

export function canvasImageFileName(canvas: DownloadableCanvasImage, options: DownloadCanvasImageOptions = {}): string {
  const roomName = sanitizeFilePart(options.roomName ?? 'pixel-world');
  return `${roomName}-canvas-${canvas.width}x${canvas.height}-${timestampFilePart(options.savedAt)}.png`;
}

function clickDownloadLink(href: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  if (!canvas.toBlob) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export async function downloadCanvasImage(canvasImage: DownloadableCanvasImage, options: DownloadCanvasImageOptions = {}): Promise<void> {
  if (typeof document === 'undefined' || canvasImage.width <= 0 || canvasImage.height <= 0) {
    throw new Error('canvas_image_download_unavailable');
  }

  const scale = canvasImageScale(canvasImage.width, canvasImage.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvasImage.width * scale;
  canvas.height = canvasImage.height * scale;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('canvas_image_canvas_unavailable');
  }

  context.imageSmoothingEnabled = false;
  context.fillStyle = canvasImage.defaultColorHex;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const pixel of canvasImage.pixels) {
    if (pixel.x < 0 || pixel.x >= canvasImage.width || pixel.y < 0 || pixel.y >= canvasImage.height) {
      continue;
    }

    context.fillStyle = pixel.colorHex;
    context.fillRect(pixel.x * scale, pixel.y * scale, scale, scale);
  }

  const fileName = canvasImageFileName(canvasImage, options);
  const blob = await canvasToBlob(canvas);
  if (blob && typeof URL !== 'undefined' && URL.createObjectURL) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      clickDownloadLink(objectUrl, fileName);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    return;
  }

  if (!canvas.toDataURL) {
    throw new Error('canvas_image_download_unavailable');
  }

  clickDownloadLink(canvas.toDataURL('image/png'), fileName);
}
