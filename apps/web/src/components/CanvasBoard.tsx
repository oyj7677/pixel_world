'use client';

import { createElement, memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
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
const MIN_CANVAS_ZOOM = 1;
const MAX_CANVAS_ZOOM = 4;
const CANVAS_ZOOM_LEVELS = [MIN_CANVAS_ZOOM, 1.5, 2, 3, MAX_CANVAS_ZOOM] as const;
const CANVAS_ZOOM_STEP = 0.05;

type PointerPosition = {
  x: number;
  y: number;
};

type DragState = PointerPosition & {
  pointerId: number;
  scrollLeft: number;
  scrollTop: number;
};

type PinchState = {
  distance: number;
  zoom: number;
};

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

function zoomedGridMetrics(width: number, height: number, cellSize: number, zoom: number): {
  cellSize: number;
  width: number;
  height: number;
} {
  const zoomedCellSize = Math.max(MIN_GRID_CELL_SIZE, Math.round(cellSize * zoom));

  return {
    cellSize: zoomedCellSize,
    width: width * zoomedCellSize + Math.max(0, width - 1) * BOARD_GRID_GAP_SIZE,
    height: height * zoomedCellSize + Math.max(0, height - 1) * BOARD_GRID_GAP_SIZE,
  };
}

function clampCanvasZoom(zoom: number) {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, Math.round(zoom / CANVAS_ZOOM_STEP) * CANVAS_ZOOM_STEP));
}

function formatCanvasZoom(zoom: number) {
  return `${Math.round(zoom * 100)}%`;
}

function nextCanvasZoom(currentZoom: number, direction: 1 | -1): number {
  if (direction > 0) {
    return CANVAS_ZOOM_LEVELS.find((zoom) => zoom > currentZoom + 0.01) ?? MAX_CANVAS_ZOOM;
  }

  return [...CANVAS_ZOOM_LEVELS].reverse().find((zoom) => zoom < currentZoom - 0.01) ?? MIN_CANVAS_ZOOM;
}

function pointerDistance(first: PointerPosition, second: PointerPosition) {
  return Math.hypot(first.x - second.x, first.y - second.y);
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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerPositionsRef = useRef<Map<number, PointerPosition>>(new Map());
  const dragStateRef = useRef<DragState | null>(null);
  const pinchStateRef = useRef<PinchState | null>(null);
  const [availableBoardWidth, setAvailableBoardWidth] = useState<number | null>(null);
  const [canvasZoom, setCanvasZoom] = useState<number>(MIN_CANVAS_ZOOM);
  const bitmapSize = useMemo(() => bitmapBackingSize(width, height), [height, width]);
  const metrics = useMemo(
    () => gridMetrics(width, height, availableBoardWidth),
    [availableBoardWidth, height, width]
  );
  const zoomedMetrics = useMemo(
    () => zoomedGridMetrics(width, height, metrics.cellSize, canvasZoom),
    [canvasZoom, height, metrics.cellSize, width]
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
    '--canvas-board-height': `${zoomedMetrics.height}px`,
    '--canvas-board-width': `${zoomedMetrics.width}px`,
    '--canvas-pixel-size': `${zoomedMetrics.cellSize}px`,
    gridAutoRows: `${zoomedMetrics.cellSize}px`,
    gridTemplateColumns: `repeat(${width}, ${zoomedMetrics.cellSize}px)`,
  } as CSSProperties;
  const viewportStyle = {
    '--canvas-viewport-height': `${metrics.height}px`,
    '--canvas-viewport-width': `${metrics.width}px`,
  } as CSSProperties;
  const zoomLabel = formatCanvasZoom(canvasZoom);
  const canZoomOut = canvasZoom > MIN_CANVAS_ZOOM;
  const canZoomIn = canvasZoom < MAX_CANVAS_ZOOM;

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
    setCanvasZoom(MIN_CANVAS_ZOOM);
  }, [height, width]);

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

  function updateCanvasZoom(nextZoom: number) {
    setCanvasZoom(clampCanvasZoom(nextZoom));
  }

  function handleZoomButtonClick(direction: 1 | -1) {
    setCanvasZoom((currentZoom) => nextCanvasZoom(currentZoom, direction));
  }

  function handleViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a progressive enhancement for drag/pinch handling.
    }

    pointerPositionsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointerPositionsRef.current.size >= 2) {
      const [first, second] = Array.from(pointerPositionsRef.current.values());
      if (first && second) {
        pinchStateRef.current = {
          distance: Math.max(1, pointerDistance(first, second)),
          zoom: canvasZoom,
        };
        dragStateRef.current = null;
      }
      return;
    }

    if (canvasZoom > MIN_CANVAS_ZOOM) {
      dragStateRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      };
    }
  }

  function handleViewportPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport || !pointerPositionsRef.current.has(event.pointerId)) {
      return;
    }

    pointerPositionsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointerPositionsRef.current.size >= 2 && pinchStateRef.current) {
      const [first, second] = Array.from(pointerPositionsRef.current.values());
      if (!first || !second) {
        return;
      }

      const nextDistance = Math.max(1, pointerDistance(first, second));
      updateCanvasZoom(pinchStateRef.current.zoom * (nextDistance / pinchStateRef.current.distance));
      event.preventDefault();
      return;
    }

    const dragState = dragStateRef.current;
    if (dragState && dragState.pointerId === event.pointerId) {
      viewport.scrollLeft = dragState.scrollLeft - (event.clientX - dragState.x);
      viewport.scrollTop = dragState.scrollTop - (event.clientY - dragState.y);
      event.preventDefault();
    }
  }

  function handleViewportPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointerPositionsRef.current.delete(event.pointerId);

    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
    }

    if (pointerPositionsRef.current.size < 2) {
      pinchStateRef.current = null;
    }
  }

  const boardElement = useBitmapBoard
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
      );

  return createElement(
    'section',
    { className: 'panel canvas-board-panel', 'aria-label': '픽셀 캔버스', ref: panelRef },
    createElement(
      'div',
      { className: 'canvas-zoom-controls', role: 'group', 'aria-label': '캔버스 확대/축소' },
      createElement(
        'button',
        {
          'aria-label': '캔버스 축소',
          className: 'canvas-zoom-button',
          disabled: !canZoomOut,
          onClick: () => handleZoomButtonClick(-1),
          type: 'button',
        },
        '−'
      ),
      createElement('span', { className: 'canvas-zoom-value', 'aria-live': 'polite' }, zoomLabel),
      createElement(
        'button',
        {
          'aria-label': '캔버스 확대',
          className: 'canvas-zoom-button',
          disabled: !canZoomIn,
          onClick: () => handleZoomButtonClick(1),
          type: 'button',
        },
        '+'
      ),
      createElement(
        'button',
        {
          'aria-label': '캔버스 기본 크기로',
          className: 'canvas-zoom-reset',
          disabled: !canZoomOut,
          onClick: () => updateCanvasZoom(MIN_CANVAS_ZOOM),
          type: 'button',
        },
        '초기화'
      )
    ),
    createElement(
      'div',
      {
        className: `canvas-board-viewport${canvasZoom > MIN_CANVAS_ZOOM ? ' canvas-board-viewport--zoomed' : ''}`,
        onPointerCancel: handleViewportPointerEnd,
        onPointerDown: handleViewportPointerDown,
        onPointerMove: handleViewportPointerMove,
        onPointerUp: handleViewportPointerEnd,
        ref: viewportRef,
        style: viewportStyle,
      },
      boardElement
    ),
    createElement('p', { className: 'canvas-zoom-help' }, '앱에서는 +/− 버튼 또는 두 손가락 핀치로 확대하고, 확대 후 캔버스를 끌어 이동할 수 있어요.')
  );
});
