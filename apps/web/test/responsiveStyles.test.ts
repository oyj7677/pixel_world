import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

function styleBlock(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('responsive global styles', () => {
  it('keeps core screens usable on phone-sized viewports', () => {
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('touch-action: manipulation');
    expect(css).toContain('.canvas-board {');
    expect(css).toContain('min-width: 0');
    expect(css).toContain('.primary-action,');
    expect(css).toContain('width: 100%');
  });

  it('moves room secondary actions into a mobile floating menu', () => {
    expect(css).toContain('.room-invite-row');
    expect(css).toContain('grid-template-columns: 1fr 1fr');
    expect(css).toContain('.canvas-action-menu {');
    expect(css).toContain('position: fixed');
    expect(css).toContain('.canvas-action-menu--open .canvas-action-menu__panel');
    expect(css).toContain('body:has(.room-shell) > .feedback-entry');
  });

  it('keeps zoomed app canvases inside a bounded viewport instead of stretching the page', () => {
    expect(css).toContain('.room-shell .canvas-board-viewport');
    expect(css).toContain('max-height: min(58svh, 560px)');
    expect(styleBlock('.canvas-board-viewport--zoomed')).toContain('overflow: auto');
  });

  it('disables canvas scrolling at the default 100 percent zoom level', () => {
    expect(styleBlock('.canvas-board-viewport')).toContain('overflow: hidden');
    expect(styleBlock('.canvas-board-viewport--zoomed')).toContain('overflow: auto');
    expect(styleBlock('.canvas-board-viewport--zoomed')).toContain('touch-action: none');
  });
});
