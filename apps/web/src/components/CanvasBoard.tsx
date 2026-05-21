'use client';

import { createElement, memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { HexColor, PixelRecord } from '@pixel-world/shared';

interface CanvasBoardProps {
  width: number;
  height: number;
  pixels: PixelRecord[];
  defaultColorHex: HexColor;
  selectedColor: HexColor;
  canPlacePixel: boolean;
  onInspectPixel: (color: HexColor) => void;
  onPlacePixel: (x: number, y: number) => void;
}

const BUTTON_GRID_CELL_LIMIT = 10_000;
const BOARD_GRID_GAP_SIZE = 1;
const MIN_GRID_CELL_SIZE = 4;
const BITMAP_GRID_MIN_RENDERED_CELL_SIZE = 3;
const BITMAP_GRID_LINE_COLOR = '#334155';

function pixelKey(x: number, y: number) {
  return `${x},${y}`;
}

function boardVisualSize(width: number, height: number): number {
  const largestDimension = Math.max(width, height);
  return Math.min(760, Math.max(480, largestDimension * 16));
}

function gridMetrics(width: number, height: number, availableWidth: number | null): {
  cellSize: number;
  width: number;
  height: number;
} {
  const largestDimension = Math.max(width, height);
  if (largestDimension <= 0) {
    return { cellSize: MIN_GRID_CELL_SIZE, width: 0, height: 0 };
  }

  const targetSize = Math.min(
    boardVisualSize(width, height),
    availableWidth && availableWidth > 0 ? Math.floor(availableWidth) : Number.POSITIVE_INFINITY
  );
  const gapBudget = Math.max(0, largestDimension - 1) * BOARD_GRID_GAP_SIZE;
  const cellSize = Math.max(
    MIN_GRID_CELL_SIZE,
    Math.floor((Math.max(largestDimension, targetSize) - gapBudget) / largestDimension)
  );

  return {
    cellSize,
    width: width * cellSize + Math.max(0, width - 1) * BOARD_GRID_GAP_SIZE,
    height: height * cellSize + Math.max(0, height - 1) * BOARD_GRID_GAP_SIZE,
  };
}

function bitmapBackingSize(width: number, height: number): { width: number; height: number } {
  const largestDimension = Math.max(width, height);
  const visualSize = boardVisualSize(width, height);

  return {
    width: Math.max(width, Math.round((visualSize * width) / largestDimension)),
    height: Math.max(height, Math.round((visualSize * height) / largestDimension)),
  };
}

function cellRect(input: {
  x: number;
  y: number;
  cellWidth: number;
  cellHeight: number;
  inset: number;
}): { left: number; top: number; width: number; height: number } {
  const xStart = Math.floor(input.x * input.cellWidth);
  const yStart = Math.floor(input.y * input.cellHeight);
  const xEnd = Math.floor((input.x + 1) * input.cellWidth);
  const yEnd = Math.floor((input.y + 1) * input.cellHeight);
  const left = xStart + (input.x > 0 ? input.inset : 0);
  const top = yStart + (input.y > 0 ? input.inset : 0);

  return {
    left,
    top,
    width: Math.max(1, xEnd - left),
    height: Math.max(1, yEnd - top),
  };
}

export const CanvasBoard = memo(function CanvasBoard({
  width,
  height,
  pixels,
  defaultColorHex,
  selectedColor,
  canPlacePixel,
  onInspectPixel,
  onPlacePixel
}: CanvasBoardProps) {
  const useBitmapBoard = width * height > BUTTON_GRID_CELL_LIMIT;
  const panelRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [availableBoardWidth, setAvailableBoardWidth] = useState<number | null>(null);
  const bitmapSize = useMemo(() => bitmapBackingSize(width, height), [height, width]);
  const metrics = useMemo(
    () => gridMetrics(width, height, availableBoardWidth),
    [availableBoardWidth, height, width]
  );
  const pixelColors = useMemo(() => {
    const colors = new Map<string, HexColor>();

    for (const pixel of pixels) {
      colors.set(pixelKey(pixel.x, pixel.y), pixel.colorHex);
    }

    return colors;
  }, [pixels]);

  const cells = useMemo(
    () => useBitmapBoard
      ? []
      : Array.from({ length: width * height }, (_, index) => ({ x: index % width, y: Math.floor(index / width) })),
    [height, useBitmapBoard, width]
  );
  const boardStyle = {
    '--canvas-board-height': `${metrics.height}px`,
    '--canvas-board-width': `${metrics.width}px`,
    '--canvas-pixel-size': `${metrics.cellSize}px`,
    gridAutoRows: `${metrics.cellSize}px`,
    gridTemplateColumns: `repeat(${width}, ${metrics.cellSize}px)`,
  } as CSSProperties;

  const paintStatus = canPlacePixel
    ? `선택한 색상 ${selectedColor}로 칠할 수 있습니다. 픽셀 색상 확인도 가능합니다.`
    : `현재는 쿨타임 때문에 칠할 수 없습니다. 선택 색상은 ${selectedColor}이며 픽셀 색상 확인은 가능합니다.`;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    if (typeof ResizeObserver === 'undefined') {
      if (panel.clientWidth > 0) {
        setAvailableBoardWidth(panel.clientWidth);
      }
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.floor(entry?.contentRect.width ?? 0);
      if (nextWidth > 0) {
        setAvailableBoardWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
      }
    });

    observer.observe(panel);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!useBitmapBoard) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext('2d');
    } catch {
      return;
    }

    if (!context) {
      return;
    }

    context.imageSmoothingEnabled = false;
    const cellWidth = bitmapSize.width / width;
    const cellHeight = bitmapSize.height / height;
    const shouldDrawGrid = Math.min(cellWidth, cellHeight) >= BITMAP_GRID_MIN_RENDERED_CELL_SIZE;
    const inset = shouldDrawGrid ? 1 : 0;

    context.clearRect(0, 0, bitmapSize.width, bitmapSize.height);

    if (shouldDrawGrid) {
      context.fillStyle = BITMAP_GRID_LINE_COLOR;
      context.fillRect(0, 0, bitmapSize.width, bitmapSize.height);

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const color = pixelColors.get(pixelKey(x, y)) ?? defaultColorHex;
          const rect = cellRect({ x, y, cellWidth, cellHeight, inset });
          context.fillStyle = color;
          context.fillRect(rect.left, rect.top, rect.width, rect.height);
        }
      }

      return;
    }

    context.fillStyle = defaultColorHex;
    context.fillRect(0, 0, bitmapSize.width, bitmapSize.height);

    for (const pixel of pixels) {
      if (pixel.x < 0 || pixel.x >= width || pixel.y < 0 || pixel.y >= height) {
        continue;
      }

      const rect = cellRect({ x: pixel.x, y: pixel.y, cellWidth, cellHeight, inset });
      context.fillStyle = pixel.colorHex;
      context.fillRect(rect.left, rect.top, rect.width, rect.height);
    }
  }, [bitmapSize.height, bitmapSize.width, defaultColorHex, height, pixelColors, pixels, useBitmapBoard, width]);

  function handleBitmapBoardClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const x = Math.min(width - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * height)));
    const color = pixelColors.get(pixelKey(x, y)) ?? defaultColorHex;

    onInspectPixel(color);
    if (canPlacePixel) {
      onPlacePixel(x, y);
    }
  }

  return createElement(
    'section',
    { className: 'panel canvas-board-panel', 'aria-label': '픽셀 캔버스', ref: panelRef },
    useBitmapBoard
      ? createElement('canvas', {
          'aria-description': paintStatus,
          'aria-label': `${width}×${height} 픽셀 캔버스`,
          className: 'canvas-board canvas-board--bitmap',
          height: bitmapSize.height,
          onClick: handleBitmapBoardClick,
          ref: canvasRef,
          role: 'grid',
          style: boardStyle,
          tabIndex: 0,
          width: bitmapSize.width,
        })
      : createElement(
          'div',
          {
            'aria-description': paintStatus,
            'aria-label': `${width}×${height} 픽셀 캔버스`,
            className: 'canvas-board',
            role: 'grid',
            style: boardStyle
          },
          cells.map(({ x, y }) => {
            const color = pixelColors.get(pixelKey(x, y)) ?? defaultColorHex;

            return createElement('button', {
              'aria-description': paintStatus,
              'aria-label': `픽셀 ${x},${y}`,
              className: 'canvas-pixel',
              key: pixelKey(x, y),
              onClick: () => {
                onInspectPixel(color);
                if (canPlacePixel) {
                  onPlacePixel(x, y);
                }
              },
              style: { backgroundColor: color },
              title: `픽셀 ${x},${y}: ${color}`,
              type: 'button'
            });
          })
        )
  );
});
