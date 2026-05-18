// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import HomePage from '../src/app/page';

describe('HomePage landing', () => {
  afterEach(() => cleanup());

  it('focuses the first screen on host nickname, room name, invite link creation, and a lower ad slot', () => {
    render(createElement(HomePage));

    expect(screen.getByLabelText('방장 닉네임')).toBeVisible();
    expect(screen.getByLabelText('방 이름')).toBeVisible();
    expect(screen.getByRole('button', { name: '초대 링크 만들기' })).toBeVisible();
    expect(screen.getByRole('region', { name: '초대 링크 아래 광고' })).toHaveAttribute(
      'data-ad-placement',
      'home-room-after-create'
    );

    expect(screen.queryByText('기존 전체 캔버스 열기')).not.toBeInTheDocument();
    expect(screen.queryByText('실시간 캔버스를 불러오는 중…')).not.toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: '100×100 픽셀 캔버스' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '사이드바 광고' })).not.toBeInTheDocument();
  });
});
