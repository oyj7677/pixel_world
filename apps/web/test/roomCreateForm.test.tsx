// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomCreateForm } from '../src/components/RoomCreateForm';
import { createRoom, getRoomToday } from '../src/lib/roomApi';

const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock
  })
}));

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
    routerPushMock.mockReset();
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

  it('creates a room from host nickname and room name and enters it immediately', async () => {
    createRoomMock.mockResolvedValue({
      roomPublicId: 'room_public_123',
      roomName: '금요일 친구들',
      todayDailyCanvasId: 'daily_123',
      canvasId: 'room_canvas_123',
      canvasSize: { width: 48, height: 48 },
      inviteUrl: 'https://pixel-world.test/i/invite-token-123',
      inviteCode: 'AB12',
      ownerDisplayName: '민아'
    });

    render(createElement(RoomCreateForm));

    fireEvent.change(screen.getByLabelText('방장 닉네임'), { target: { value: '민아' } });
    fireEvent.change(screen.getByLabelText('방 이름'), { target: { value: '금요일 친구들' } });
    expect(screen.getByRole('button', { name: /작게.*48픽셀/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /중간.*56픽셀/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /크게.*64픽셀/ })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '방 만들기' }));

    await waitFor(() => {
      expect(createRoomMock).toHaveBeenCalledWith({ name: '금요일 친구들', ownerDisplayName: '민아', canvasDimension: 48 });
    });
    expect(createRoomMock).toHaveBeenCalledTimes(1);
    expect(routerPushMock).toHaveBeenCalledWith('/r/room_public_123?inviteCode=AB12');
    expect(screen.queryByText('초대 준비 완료')).not.toBeInTheDocument();
  });

  it('selects a preset canvas size instead of accepting a free-form number', async () => {
    createRoomMock.mockResolvedValue({
      roomPublicId: 'room_public_456',
      roomName: '중간 방',
      todayDailyCanvasId: 'daily_456',
      canvasId: 'room_canvas_456',
      canvasSize: { width: 56, height: 56 },
      inviteUrl: 'https://pixel-world.test/i/invite-token-456',
      inviteCode: 'CD34',
      ownerDisplayName: '준호'
    });

    render(createElement(RoomCreateForm));

    fireEvent.change(screen.getByLabelText('방장 닉네임'), { target: { value: '준호' } });
    fireEvent.change(screen.getByLabelText('방 이름'), { target: { value: '중간 방' } });
    fireEvent.click(screen.getByRole('button', { name: /중간.*56픽셀/ }));
    fireEvent.click(screen.getByRole('button', { name: '방 만들기' }));

    await waitFor(() => {
      expect(createRoomMock).toHaveBeenCalledWith({ name: '중간 방', ownerDisplayName: '준호', canvasDimension: 56 });
    });
    expect(screen.queryByLabelText('가로 픽셀 수')).not.toBeInTheDocument();
    expect(routerPushMock).toHaveBeenCalledWith('/r/room_public_456?inviteCode=CD34');
  });

  it('announces room creation loading and errors to assistive tech', async () => {
    createRoomMock.mockRejectedValue(new Error('network down'));
    render(createElement(RoomCreateForm));

    fireEvent.change(screen.getByLabelText('방장 닉네임'), { target: { value: '민아' } });
    fireEvent.change(screen.getByLabelText('방 이름'), { target: { value: '금요일 친구들' } });
    fireEvent.click(screen.getByRole('button', { name: '방 만들기' }));

    expect(screen.getByRole('button', { name: '방 만드는 중…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('방을 만드는 중…');
    expect(await screen.findByRole('alert')).toHaveTextContent('방을 만들지 못했습니다');
  });
});
