import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

describe('responsive global styles', () => {
  it('keeps core screens usable on phone-sized viewports', () => {
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('touch-action: manipulation');
    expect(css).toContain('.canvas-board {');
    expect(css).toContain('min-width: 0');
    expect(css).toContain('.primary-action,');
    expect(css).toContain('width: 100%');
  });
});
