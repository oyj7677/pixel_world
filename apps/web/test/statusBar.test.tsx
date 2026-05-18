// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBar } from '../src/components/StatusBar';

const baseAllowance = {
  savedPixelCount: 2,
  maxSavedPixelCount: 208,
  dynamicAllowanceIntervalMs: 8640,
  nextPixelSavedAt: new Date(Date.now() + 8640).toISOString(),
  maxStorageEndsAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
};

describe('StatusBar', () => {
  afterEach(() => cleanup());

  it('shows saved pixel count and calm pacing copy when pixels are ready', () => {
    render(createElement(StatusBar, { onlineCount: 3, remainingMs: 7300, connected: true, allowance: baseAllowance }));

    expect(screen.getByText('2개 저장됨')).toBeVisible();
    expect(screen.getByText('이 프로젝트 속도에 맞춰 준비됨')).toBeVisible();
    expect(screen.queryByText('COOLDOWN')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Pixel cooldown' })).not.toBeInTheDocument();
    expect(screen.queryByText(/사용 전/i)).not.toBeInTheDocument();
  });

  it('shows only a calm next saved time when no saved pixels are ready', () => {
    render(
      createElement(StatusBar, {
        onlineCount: 3,
        remainingMs: 7300,
        connected: true,
        allowance: { ...baseAllowance, savedPixelCount: 0 }
      })
    );

    expect(screen.getByText('0개 저장됨')).toBeVisible();
    expect(screen.getByText('8초 후 충전')).toBeVisible();
    expect(screen.queryByText('COOLDOWN')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Pixel cooldown' })).not.toBeInTheDocument();
    expect(screen.queryByText(/사용 전/i)).not.toBeInTheDocument();
  });

  it('shows unknown saved pixel state while preserving legacy next timing', () => {
    render(createElement(StatusBar, { onlineCount: 3, remainingMs: 7300, connected: true, allowance: null }));

    expect(screen.getByText('—')).toBeVisible();
    expect(screen.getByText('8초 후 충전')).toBeVisible();
    expect(screen.queryByText('0개 저장됨')).not.toBeInTheDocument();
    expect(screen.queryByText('COOLDOWN')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Pixel cooldown' })).not.toBeInTheDocument();
    expect(screen.queryByText(/사용 전/i)).not.toBeInTheDocument();
  });
});
