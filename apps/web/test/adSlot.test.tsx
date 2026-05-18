// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AdSlot } from '../src/components/AdSlot';

describe('AdSlot', () => {
  afterEach(() => cleanup());

  it('reserves a labeled 구글 애드센스 placement without loading ads yet', () => {
    render(createElement(AdSlot, { placement: 'home-top-leaderboard', label: '상단 배너 광고' }));

    const slot = screen.getByRole('region', { name: '상단 배너 광고' });
    expect(slot).toHaveAttribute('data-ad-placement', 'home-top-leaderboard');
    expect(slot).toHaveTextContent('구글 애드센스');
    expect(slot).toHaveTextContent('퍼블리셔 ID와 슬롯 ID');
  });

  it('marks the invite-link follow-up placement as the new first-screen ad slot', () => {
    render(createElement(AdSlot, { placement: 'home-room-after-create', label: '초대 링크 아래 광고' }));

    const slot = screen.getByRole('region', { name: '초대 링크 아래 광고' });
    expect(slot).toHaveAttribute('data-ad-placement', 'home-room-after-create');
    expect(slot).toHaveClass('adsense-slot--room-after-create');
    expect(slot).toHaveTextContent('초대 링크를 만든 뒤 자연스럽게 보이는 위치입니다');
  });
});
