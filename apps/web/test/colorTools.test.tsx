// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorTools } from '../src/components/ColorTools';

describe('ColorTools', () => {
  afterEach(() => cleanup());

  it('selects a palette color', () => {
    const onColorChange = vi.fn();

    render(
      createElement(ColorTools, {
        selectedColor: '#38BDF8',
        eyedropperColor: null,
        onColorChange
      })
    );

    fireEvent.click(screen.getByRole('button', { name: '#EF4444 선택' }));

    expect(onColorChange).toHaveBeenCalledWith('#EF4444');
  });

  it('normalizes complete hex input and shows eyedropper rgb values', () => {
    const onColorChange = vi.fn();

    render(
      createElement(ColorTools, {
        selectedColor: '#38BDF8',
        eyedropperColor: '#EF4444',
        onColorChange
      })
    );

    fireEvent.change(screen.getByLabelText('HEX 색상값'), { target: { value: '22c55e' } });

    expect(onColorChange).toHaveBeenCalledWith('#22C55E');
    expect(screen.getByText('#EF4444')).toBeVisible();
    expect(screen.getByText('RGB 239, 68, 68')).toBeVisible();
  });

  it('selects any color from the custom color picker', () => {
    const onColorChange = vi.fn();

    render(
      createElement(ColorTools, {
        selectedColor: '#38BDF8',
        eyedropperColor: null,
        onColorChange
      })
    );

    fireEvent.change(screen.getByLabelText('직접 색상 선택'), { target: { value: '#a855f7' } });

    expect(onColorChange).toHaveBeenCalledWith('#A855F7');
    expect(screen.getByText('선택한 색상 #38BDF8')).toBeVisible();
  });

  it('reverts invalid hex draft on blur', () => {
    const onColorChange = vi.fn();

    render(
      createElement(ColorTools, {
        selectedColor: '#38BDF8',
        eyedropperColor: null,
        onColorChange
      })
    );

    const input = screen.getByLabelText('HEX 색상값');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'not-a-color' } });
    fireEvent.blur(input);

    expect(input).toHaveValue('#38BDF8');
    expect(onColorChange).not.toHaveBeenCalled();
  });
});
