// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasBoard } from '../src/components/CanvasBoard';

const pixels = [{ x: 1, y: 2, colorHex: '#38BDF8' as const, updatedAt: new Date().toISOString() }];

describe('CanvasBoard', () => {
  afterEach(() => cleanup());

  it('calls eyedropper and placement callbacks for a clicked pixel', () => {
    const onInspectPixel = vi.fn();
    const onPlacePixel = vi.fn();

    render(
      createElement(CanvasBoard, {
        width: 3,
        height: 3,
        pixels,
        defaultColorHex: '#FFFFFF',
        selectedColor: '#EF4444',
        canPlacePixel: true,
        onInspectPixel,
        onPlacePixel
      })
    );

    fireEvent.click(screen.getByRole('button', { name: '픽셀 1,2' }));

    expect(onInspectPixel).toHaveBeenCalledWith('#38BDF8');
    expect(onPlacePixel).toHaveBeenCalledWith(1, 2);
  });

  it('allows eyedropper inspection while placement is unavailable', () => {
    const onInspectPixel = vi.fn();
    const onPlacePixel = vi.fn();

    render(
      createElement(CanvasBoard, {
        width: 3,
        height: 3,
        pixels,
        defaultColorHex: '#FFFFFF',
        selectedColor: '#EF4444',
        canPlacePixel: false,
        onInspectPixel,
        onPlacePixel
      })
    );

    const pixel = screen.getByRole('button', { name: '픽셀 1,2' });
    fireEvent.click(pixel);

    expect(pixel).not.toHaveAttribute('aria-disabled');
    expect(pixel).toHaveAccessibleDescription(
      '현재는 쿨타임 때문에 칠할 수 없습니다. 선택 색상은 #EF4444이며 픽셀 색상 확인은 가능합니다.'
    );
    expect(onInspectPixel).toHaveBeenCalledWith('#38BDF8');
    expect(onPlacePixel).not.toHaveBeenCalled();
  });
});
