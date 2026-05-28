// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasBoard } from '../src/components/CanvasBoard';

const pixels = [{ x: 1, y: 2, colorHex: '#38BDF8' as const, updatedAt: new Date().toISOString() }];

describe('CanvasBoard', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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

  it('does not capture a simple pixel tap before the browser can deliver its click', () => {
    const onInspectPixel = vi.fn();
    const onPlacePixel = vi.fn();
    const setPointerCapture = vi.fn();
    const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
    HTMLElement.prototype.setPointerCapture = setPointerCapture;

    try {
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

      const pixel = screen.getByRole('button', { name: '픽셀 1,2' });
      fireEvent.pointerDown(pixel, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(pixel, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.click(pixel);

      expect(setPointerCapture).not.toHaveBeenCalled();
      expect(onInspectPixel).toHaveBeenCalledWith('#38BDF8');
      expect(onPlacePixel).toHaveBeenCalledWith(1, 2);
    } finally {
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
    }
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

  it('uses integer-sized tracks for a 56 by 56 button grid so grid lines stay even', () => {
    render(
      createElement(CanvasBoard, {
        width: 56,
        height: 56,
        pixels: [],
        defaultColorHex: '#FFFFFF',
        selectedColor: '#EF4444',
        canPlacePixel: true,
        onInspectPixel: vi.fn(),
        onPlacePixel: vi.fn()
      })
    );

    const board = screen.getByRole('grid', { name: '56×56 픽셀 캔버스' });

    const boardElement = board as HTMLElement;
    expect(boardElement.style.getPropertyValue('--canvas-board-width')).toBe('727px');
    expect(boardElement.style.getPropertyValue('--canvas-board-height')).toBe('727px');
    expect(boardElement.style.gridAutoRows).toBe('12px');
    expect(boardElement.style.gridTemplateColumns).toBe('repeat(56, 12px)');
  });

  it('lets app users zoom the canvas for more precise pixel selection', () => {
    render(
      createElement(CanvasBoard, {
        width: 56,
        height: 56,
        pixels: [],
        defaultColorHex: '#FFFFFF',
        selectedColor: '#EF4444',
        canPlacePixel: true,
        onInspectPixel: vi.fn(),
        onPlacePixel: vi.fn()
      })
    );

    const board = screen.getByRole('grid', { name: '56×56 픽셀 캔버스' }) as HTMLElement;
    const viewport = board.closest('.canvas-board-viewport') as HTMLElement;
    expect(viewport.style.getPropertyValue('--canvas-viewport-width')).toBe('727px');
    expect(viewport.style.getPropertyValue('--canvas-viewport-height')).toBe('727px');
    expect(screen.getByRole('group', { name: '캔버스 확대/축소' })).toBeVisible();
    expect(screen.getByText('100%')).toBeVisible();
    expect(screen.getByRole('button', { name: '캔버스 축소' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '캔버스 확대' }));

    expect(screen.getByText('150%')).toBeVisible();
    expect(viewport.style.getPropertyValue('--canvas-viewport-width')).toBe('727px');
    expect(viewport.style.getPropertyValue('--canvas-viewport-height')).toBe('727px');
    expect(board.style.getPropertyValue('--canvas-board-width')).toBe('1063px');
    expect(board.style.getPropertyValue('--canvas-board-height')).toBe('1063px');
    expect(board.style.gridAutoRows).toBe('18px');
    expect(screen.getByRole('button', { name: '캔버스 기본 크기로' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '캔버스 기본 크기로' }));

    expect(screen.getByText('100%')).toBeVisible();
    expect(board.style.getPropertyValue('--canvas-board-width')).toBe('727px');
    expect(board.style.gridAutoRows).toBe('12px');
  }, 10000);

  it('maps clicks on a large bitmap-rendered board back to pixel coordinates', () => {
    const onInspectPixel = vi.fn();
    const onPlacePixel = vi.fn();
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
      imageSmoothingEnabled: true,
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
      context as unknown as CanvasRenderingContext2D
    ));
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 500,
      height: 500,
      left: 0,
      right: 500,
      top: 0,
      width: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));

    render(
      createElement(CanvasBoard, {
        width: 500,
        height: 500,
        pixels: [{ x: 250, y: 250, colorHex: '#38BDF8' as const, updatedAt: new Date().toISOString() }],
        defaultColorHex: '#FFFFFF',
        selectedColor: '#EF4444',
        canPlacePixel: true,
        onInspectPixel,
        onPlacePixel
      })
    );

    fireEvent.click(screen.getByRole('grid', { name: '500×500 픽셀 캔버스' }), {
      clientX: 250,
      clientY: 250,
    });

    expect(screen.queryByRole('button', { name: '픽셀 250,250' })).not.toBeInTheDocument();
    expect(onInspectPixel).toHaveBeenCalledWith('#38BDF8');
    expect(onPlacePixel).toHaveBeenCalledWith(250, 250);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 760, 760);
    expect(context.fillRect).toHaveBeenCalledWith(380, 380, 1, 1);
  });

  it('draws visible grid gaps for a 200 by 200 bitmap-rendered board', () => {
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
      imageSmoothingEnabled: true,
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
      context as unknown as CanvasRenderingContext2D
    ));

    render(
      createElement(CanvasBoard, {
        width: 200,
        height: 200,
        pixels: [{ x: 100, y: 100, colorHex: '#38BDF8' as const, updatedAt: new Date().toISOString() }],
        defaultColorHex: '#FFFFFF',
        selectedColor: '#EF4444',
        canPlacePixel: true,
        onInspectPixel: vi.fn(),
        onPlacePixel: vi.fn()
      })
    );

    const board = screen.getByRole('grid', { name: '200×200 픽셀 캔버스' });
    expect(board).toHaveAttribute('width', '760');
    expect(board).toHaveAttribute('height', '760');
    expect(screen.queryByRole('button', { name: '픽셀 100,100' })).not.toBeInTheDocument();
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 760, 760);
    expect(context.fillRect).toHaveBeenCalledWith(381, 381, 2, 2);
  });
});
