// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppNav } from '../src/components/AppNav';

describe('AppNav', () => {
  afterEach(() => cleanup());

  it('keeps the header focused on creating friend rooms', () => {
    render(createElement(AppNav, { currentPath: '/' }));

    expect(screen.getByRole('link', { name: '픽셀 월드 홈' })).toHaveAttribute('href', '/');
    expect(screen.getByText('친구 방 만들기')).toBeVisible();
    expect(screen.queryByRole('link', { name: '캔버스' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).not.toBeInTheDocument();
  });
});
