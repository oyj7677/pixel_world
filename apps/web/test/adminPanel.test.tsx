// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminPanel } from '../src/components/AdminPanel';

function okResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

describe('AdminPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('submits a confirmed moderation area reset with a reason and selected coordinates', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);

      if (path.endsWith('/admin/login')) {
        return okResponse({ ok: true });
      }

      if (path.endsWith('/admin/restore/area')) {
        return okResponse({
          events: [
            { id: '1', x: 2, y: 3, newColorHex: '#FFFFFF', createdAt: new Date().toISOString() },
            { id: '2', x: 3, y: 4, newColorHex: '#FFFFFF', createdAt: new Date().toISOString() }
          ]
        });
      }

      return okResponse({ events: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(AdminPanel));

    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'admin-password' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByText('관리자 세션이 활성화되었습니다')).toBeVisible();
    expect(screen.getByRole('button', { name: '선택 영역 초기화' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('시작 X'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('시작 Y'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('끝 X'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('끝 Y'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('관리 사유'), { target: { value: 'spam' } });
    fireEvent.change(screen.getByLabelText('확인을 위해 초기화를 입력하세요'), { target: { value: '초기화' } });

    expect(screen.getByText('4개 픽셀 선택됨')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '선택 영역 초기화' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/restore/area'),
        expect.objectContaining({ method: 'POST', body: expect.any(String) })
      );
    });

    const resetCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/admin/restore/area'));
    expect(resetCall).toBeDefined();
    expect(JSON.parse(resetCall![1]!.body as string)).toEqual({
      fromX: 2,
      fromY: 3,
      toX: 3,
      toY: 4,
      colorHex: '#FFFFFF',
      reason: 'spam'
    });
    expect(await screen.findByText('4개 픽셀을 #FFFFFF로 초기화했습니다')).toBeVisible();
  });
});
