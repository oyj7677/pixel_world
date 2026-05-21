// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HomePage from '../src/app/page';

const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock
  })
}));

describe('HomePage landing', () => {
  afterEach(() => {
    cleanup();
    routerPushMock.mockReset();
  });

  it('focuses the first screen on joining by code and creating a room without an ad slot', () => {
    render(createElement(HomePage));

    expect(screen.getByLabelText('입장 코드')).toBeVisible();
    expect(screen.getByRole('button', { name: '코드로 입장' })).toBeVisible();
    expect(screen.getByLabelText('방장 닉네임')).toBeVisible();
    expect(screen.getByLabelText('방 이름')).toBeVisible();
    expect(screen.getByRole('button', { name: '방 만들기' })).toBeVisible();
    expect(screen.queryByText('광고 영역')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /광고/ })).not.toBeInTheDocument();

    expect(screen.queryByText('기존 전체 캔버스 열기')).not.toBeInTheDocument();
    expect(screen.queryByText('실시간 캔버스를 불러오는 중…')).not.toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: '100×100 픽셀 캔버스' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '사이드바 광고' })).not.toBeInTheDocument();
  });
});
