// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PixelSampleGallery } from '../src/components/PixelSampleGallery';

describe('PixelSampleGallery', () => {
  afterEach(() => cleanup());

  it('renders drawable pixel sample screens', () => {
    render(createElement(PixelSampleGallery));

    expect(screen.getByRole('heading', { name: '샘플 화면' })).toBeVisible();
    expect(screen.getByRole('img', { name: '하트 샘플 화면' })).toBeVisible();
    expect(screen.getByRole('img', { name: '스마일 샘플 화면' })).toBeVisible();
    expect(screen.getByRole('img', { name: '작은 집 샘플 화면' })).toBeVisible();

    const heart = screen.getByRole('img', { name: '하트 샘플 화면' });
    expect(heart.querySelectorAll('.pixel-sample-cell')).toHaveLength(144);
  });

  it('turns a clicked sample screen into a shared sample payload', () => {
    const onSampleSelect = vi.fn();
    render(createElement(PixelSampleGallery, {
      canvasWidth: 48,
      canvasHeight: 48,
      defaultColorHex: '#FFFFFF',
      onSampleSelect,
    }));

    fireEvent.click(screen.getByRole('button', { name: '하트 샘플 화면 공유 샘플로 등록' }));

    expect(onSampleSelect).toHaveBeenCalledWith(expect.objectContaining({
      name: '하트 샘플',
      width: 48,
      height: 48,
      defaultColorHex: '#FFFFFF',
    }));
    expect(onSampleSelect.mock.calls[0]?.[0].pixels).toContainEqual({
      x: 16,
      y: 4,
      colorHex: '#FB7185',
    });
  });
});
