// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RecentEvents } from '../src/components/RecentEvents';

describe('RecentEvents', () => {
  afterEach(() => cleanup());

  it('labels the list as the current user history', () => {
    render(createElement(RecentEvents, { events: [] }));

    expect(screen.getByRole('region', { name: '내 최근 픽셀 변경' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '내 최근 활동' })).toBeVisible();
  });
});
