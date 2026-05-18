'use client';

import { createElement, memo, useMemo } from 'react';
import type { CSSProperties } from 'react';
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

function pixelKey(x: number, y: number) {
  return `${x},${y}`;
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
  const pixelColors = useMemo(() => {
    const colors = new Map<string, HexColor>();

    for (const pixel of pixels) {
      colors.set(pixelKey(pixel.x, pixel.y), pixel.colorHex);
    }

    return colors;
  }, [pixels]);

  const cells = useMemo(
    () => Array.from({ length: width * height }, (_, index) => ({ x: index % width, y: Math.floor(index / width) })),
    [height, width]
  );
  const boardStyle: CSSProperties = { gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))` };

  const paintStatus = canPlacePixel
    ? `선택한 색상 ${selectedColor}로 칠할 수 있습니다. 픽셀 색상 확인도 가능합니다.`
    : `현재는 쿨타임 때문에 칠할 수 없습니다. 선택 색상은 ${selectedColor}이며 픽셀 색상 확인은 가능합니다.`;

  return createElement(
    'section',
    { className: 'panel canvas-board-panel', 'aria-label': '픽셀 캔버스' },
    createElement(
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
