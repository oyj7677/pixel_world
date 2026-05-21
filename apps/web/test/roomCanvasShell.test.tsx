// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasSnapshotPayload, PublicRecentPixelEvent } from '@pixel-world/shared';
import { RoomCanvasShell } from '../src/components/RoomCanvasShell';
import { createRoomInvite, getRoomToday } from '../src/lib/roomApi';
import { createPixelSocket } from '../src/lib/socketClient';

vi.mock('../src/lib/roomApi', () => ({
  createRoomInvite: vi.fn(async () => ({
    roomPublicId: 'room_public_123',
    inviteUrl: 'http://localhost:3000/i/fresh-token',
    inviteCode: 'AB12'
  })),
  getRoomToday: vi.fn(async () => ({
    roomPublicId: 'room_public_123',
    roomName: '금요일 친구들',
    todayDailyCanvasId: 'daily-1',
    canvasId: 'room-canvas-1',
    canvasSize: { width: 2, height: 2 }
  }))
}));

const socketHandlers = new Map<string, (payload: unknown) => void>();
const emitted: Array<{ event: string; payload: unknown }> = [];

vi.mock('../src/lib/socketClient', () => ({
  createPixelSocket: vi.fn(() => ({
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      socketHandlers.set(event, handler);
    }),
    emit: vi.fn((event: string, payload: unknown) => {
      emitted.push({ event, payload });
    }),
    disconnect: vi.fn()
  }))
}));

function emitSocket<T>(event: string, payload: T): void {
  const handler = socketHandlers.get(event);
  expect(handler, `handler for ${event}`).toBeDefined();
  handler!(payload);
}

function snapshot(overrides: Partial<CanvasSnapshotPayload> = {}): CanvasSnapshotPayload {
  return {
    roomPublicId: 'room_public_123',
    dailyCanvasId: 'daily-1',
    canvasId: 'room-canvas-1',
    width: 2,
    height: 2,
    defaultColorHex: '#FFFFFF',
    pixels: [],
    recentEvents: [],
    onlineCount: 4,
    nextAvailableAt: new Date(Date.now() + 5000).toISOString(),
    pixelAllowance: {
      targetCompletionMs: 6 * 60 * 60 * 1000,
      requiredPixelCount: 4,
      effectiveParticipantCount: 2,
      dynamicAllowanceIntervalMs: 1000,
      savedPixelCount: 3,
      maxSavedPixelCount: 20,
      nextPixelSavedAt: new Date(Date.now() + 1000).toISOString(),
      maxStorageEndsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    },
    ...overrides
  };
}

describe('RoomCanvasShell', () => {
  afterEach(() => {
    cleanup();
    socketHandlers.clear();
    emitted.splice(0);
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined
    });
  });

  it('shows saved pixel actions without urgent expiry copy', async () => {
    render(createElement(RoomCanvasShell, { roomPublicId: 'room_public_123' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('방 캔버스를 불러오는 중'));
    emitSocket('connect', undefined);
    emitSocket('canvasSnapshot', snapshot());

    expect(await screen.findByText('3개 저장됨')).toBeVisible();
    expect(screen.getByText('이 프로젝트 속도에 맞춰 준비됨')).toBeVisible();
    expect(screen.queryByText(/사용 전/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/expires?/i)).not.toBeInTheDocument();
  });

  it('lets room members place pixels even before they have personal recent activity', async () => {
    render(createElement(RoomCanvasShell, { roomPublicId: 'room_public_123' }));

    await waitFor(() => expect(socketHandlers.has('connect')).toBe(true));
    emitSocket('connect', undefined);
    emitSocket('canvasSnapshot', snapshot({ recentEvents: [] }));

    expect(await screen.findByRole('region', { name: '방 캔버스' })).toBeVisible();
    expect(screen.getByRole('region', { name: '방 직접 칠하기 도구' })).toBeVisible();
    expect(screen.queryByText('먼저 퀵 픽셀을 남기면 직접 픽셀을 칠할 수 있어요.')).not.toBeInTheDocument();

    const pixel = screen.getByRole('button', { name: '픽셀 1,1' });
    expect(screen.getByRole('grid', { name: '2×2 픽셀 캔버스' })).toHaveAccessibleDescription(/선택한 색상 #38BDF8로 칠할 수 있습니다/);
    fireEvent.click(pixel);

    expect(emitted).toContainEqual({
      event: 'placePixel',
      payload: {
        roomPublicId: 'room_public_123',
        dailyCanvasId: 'daily-1',
        canvasId: 'room-canvas-1',
        x: 1,
        y: 1,
        colorHex: '#38BDF8'
      }
    });
  });

  it('locally saves a manual room pixel after nextPixelSavedAt passes without a socket event', async () => {
    render(createElement(RoomCanvasShell, { roomPublicId: 'room_public_123' }));

    await waitFor(() => expect(socketHandlers.has('connect')).toBe(true));

    vi.useFakeTimers();
    const now = new Date('2026-05-16T00:00:00.000Z');
    vi.setSystemTime(now);

    try {
      await act(async () => {
        emitSocket('connect', undefined);
        emitSocket('canvasSnapshot', snapshot({
          recentEvents: [
            {
              id: 'mine-1',
              roomPublicId: 'room_public_123',
              dailyCanvasId: 'daily-1',
              x: 0,
              y: 0,
              previousColorHex: null,
              newColorHex: '#22C55E',
              source: 'user',
              createdAt: now.toISOString()
            }
          ],
          pixelAllowance: {
            targetCompletionMs: 6 * 60 * 60 * 1000,
            requiredPixelCount: 4,
            effectiveParticipantCount: 2,
            dynamicAllowanceIntervalMs: 1000,
            savedPixelCount: 0,
            maxSavedPixelCount: 20,
            nextPixelSavedAt: new Date(now.getTime() + 1000).toISOString(),
            maxStorageEndsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString()
          }
        }));
      });

      const pixel = screen.getByRole('button', { name: '픽셀 1,1' });
      expect(pixel).toHaveAccessibleDescription(
        '현재는 쿨타임 때문에 칠할 수 없습니다. 선택 색상은 #38BDF8이며 픽셀 색상 확인은 가능합니다.'
      );
      expect(screen.getByText('0개 저장됨')).toBeVisible();

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(pixel).toHaveAccessibleDescription('선택한 색상 #38BDF8로 칠할 수 있습니다. 픽셀 색상 확인도 가능합니다.');
      expect(screen.getByText('1개 저장됨')).toBeVisible();

      fireEvent.click(pixel);
      expect(emitted).toContainEqual({
        event: 'placePixel',
        payload: {
          roomPublicId: 'room_public_123',
          dailyCanvasId: 'daily-1',
          canvasId: 'room-canvas-1',
          x: 1,
          y: 1,
          colorHex: '#38BDF8'
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows room recent activity separately from personal recent activity', async () => {
    render(createElement(RoomCanvasShell, { roomPublicId: 'room_public_123' }));

    await waitFor(() => expect(socketHandlers.has('connect')).toBe(true));
    emitSocket('connect', undefined);
    const myEvent: PublicRecentPixelEvent = {
      id: 'mine-1',
      roomPublicId: 'room_public_123',
      dailyCanvasId: 'daily-1',
      x: 0,
      y: 1,
      previousColorHex: null,
      newColorHex: '#38BDF8',
      source: 'user',
      createdAt: new Date().toISOString()
    };
    const roomEvent: PublicRecentPixelEvent = {
      id: 'room-1',
      roomPublicId: 'room_public_123',
      dailyCanvasId: 'daily-1',
      x: 1,
      y: 0,
      previousColorHex: null,
      newColorHex: '#F97316',
      source: 'user',
      createdAt: new Date().toISOString()
    };
    emitSocket('canvasSnapshot', snapshot({
      recentEvents: [myEvent],
      roomRecentEvents: [roomEvent]
    }));

    expect(await screen.findByRole('region', { name: '방 최근 픽셀 변경' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '방 최근 활동' })).toBeVisible();
    expect(screen.getByText('#F97316')).toBeVisible();
    expect(screen.getByRole('region', { name: '내 최근 픽셀 변경' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '내 최근 활동' })).toBeVisible();
    expect(screen.getByText('#38BDF8')).toBeVisible();
  });

  it('creates and copies a fresh invite address from the room screen', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    vi.mocked(createRoomInvite).mockResolvedValueOnce({
      roomPublicId: 'room_public_123',
      inviteUrl: 'http://localhost:3000/i/copied-token',
      inviteCode: 'CD34'
    });

    render(createElement(RoomCanvasShell, { roomPublicId: 'room_public_123' }));

    await waitFor(() => expect(socketHandlers.has('connect')).toBe(true));
    emitSocket('connect', undefined);
    emitSocket('canvasSnapshot', snapshot());

    await fireEvent.click(await screen.findByRole('button', { name: '초대 주소 복사' }));

    await waitFor(() => expect(createRoomInvite).toHaveBeenCalledWith('room_public_123', undefined));
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/i/copied-token');
    expect(screen.getByText('초대 주소를 복사했어요. 친구에게 바로 보내면 됩니다.')).toBeVisible();
    expect(screen.getByText('CD34')).toBeVisible();
    expect(screen.getByRole('link', { name: 'http://localhost:3000/i/copied-token' })).toHaveAttribute(
      'href',
      'http://localhost:3000/i/copied-token'
    );
  });

  it('keeps invite token access on mobile browsers that drop the API cookie', async () => {
    render(createElement(RoomCanvasShell, { roomPublicId: 'room_public_123', inviteToken: 'invite-token-123' }));

    await waitFor(() => expect(socketHandlers.has('connect')).toBe(true));

    expect(vi.mocked(getRoomToday)).toHaveBeenCalledWith('room_public_123', { inviteToken: 'invite-token-123' });
    expect(vi.mocked(createPixelSocket)).toHaveBeenCalledWith({
      roomPublicId: 'room_public_123',
      dailyCanvasId: 'daily-1',
      date: 'today',
      inviteToken: 'invite-token-123'
    });

    emitSocket('connect', undefined);
    emitSocket('canvasSnapshot', snapshot());
    await fireEvent.click(await screen.findByRole('button', { name: '초대 주소 복사' }));

    await waitFor(() => expect(createRoomInvite).toHaveBeenCalledWith('room_public_123', { inviteToken: 'invite-token-123' }));
  });

  it('keeps invite code access on mobile browsers that drop the API cookie', async () => {
    render(createElement(RoomCanvasShell, { roomPublicId: 'room_public_123', inviteCode: 'AB12' }));

    await waitFor(() => expect(socketHandlers.has('connect')).toBe(true));

    expect(vi.mocked(getRoomToday)).toHaveBeenCalledWith('room_public_123', { inviteCode: 'AB12' });
    expect(vi.mocked(createPixelSocket)).toHaveBeenCalledWith({
      roomPublicId: 'room_public_123',
      dailyCanvasId: 'daily-1',
      date: 'today',
      inviteCode: 'AB12'
    });

    emitSocket('connect', undefined);
    emitSocket('canvasSnapshot', snapshot());
    await fireEvent.click(await screen.findByRole('button', { name: '초대 주소 복사' }));

    await waitFor(() => expect(createRoomInvite).toHaveBeenCalledWith('room_public_123', { inviteCode: 'AB12' }));
  });
});
