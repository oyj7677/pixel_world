// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomCreateForm } from '../src/components/RoomCreateForm';
import { createRoom, getRoomToday } from '../src/lib/roomApi';

vi.mock('../src/lib/roomApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/roomApi')>();
  return {
    ...actual,
    createRoom: vi.fn()
  };
});

const createRoomMock = vi.mocked(createRoom);

describe('RoomCreateForm', () => {
  afterEach(() => {
    cleanup();
    createRoomMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('getRoomToday does not swallow 501/5xx', async () => {
    for (const status of [501, 500]) {
      const fetchMock = vi.fn(async () => new Response('{"error":"backend_error"}', { status }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(getRoomToday('room_public_123')).rejects.toThrow(String(status));

      vi.unstubAllGlobals();
    }
  });

  it('creates a room from host nickname and room name and shows invite link', async () => {
    createRoomMock.mockResolvedValue({
      roomPublicId: 'room_public_123',
      roomName: '금요일 친구들',
      todayDailyCanvasId: 'daily_123',
      canvasId: 'room_canvas_123',
      inviteUrl: 'https://pixel-world.test/i/invite-token-123',
      inviteCode: 'AB12',
      ownerDisplayName: '민아'
    });

    render(createElement(RoomCreateForm));

    fireEvent.change(screen.getByLabelText('방장 닉네임'), { target: { value: '민아' } });
    fireEvent.change(screen.getByLabelText('방 이름'), { target: { value: '금요일 친구들' } });
    fireEvent.click(screen.getByRole('button', { name: '초대 링크 만들기' }));

    await waitFor(() => {
      expect(createRoomMock).toHaveBeenCalledWith({ name: '금요일 친구들', ownerDisplayName: '민아' });
    });
    expect(createRoomMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('금요일 친구들')).toBeVisible();
    expect(screen.getByText('방장 민아')).toBeVisible();
    expect(screen.getByText('AB12')).toBeVisible();
    expect(screen.getByRole('link', { name: 'https://pixel-world.test/i/invite-token-123' })).toHaveAttribute(
      'href',
      'https://pixel-world.test/i/invite-token-123'
    );
    expect(screen.getByRole('link', { name: '방 열기' })).toHaveAttribute('href', '/r/room_public_123');
  });

  it('announces room creation loading and errors to assistive tech', async () => {
    createRoomMock.mockRejectedValue(new Error('network down'));
    render(createElement(RoomCreateForm));

    fireEvent.change(screen.getByLabelText('방장 닉네임'), { target: { value: '민아' } });
    fireEvent.change(screen.getByLabelText('방 이름'), { target: { value: '금요일 친구들' } });
    fireEvent.click(screen.getByRole('button', { name: '초대 링크 만들기' }));

    expect(screen.getByRole('button', { name: '만드는 중…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('초대 링크를 만드는 중…');
    expect(await screen.findByRole('alert')).toHaveTextContent('방을 만들지 못했습니다');
  });
});
