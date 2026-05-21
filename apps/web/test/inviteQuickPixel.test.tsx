// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InviteLandingResponseDto, QuickPixelResponseDto } from '@pixel-world/shared';
import { InviteQuickPixel } from '../src/components/InviteQuickPixel';
import { OptionalNamePrompt } from '../src/components/OptionalNamePrompt';
import { placeQuickPixel, updateRoomDisplayName } from '../src/lib/roomApi';

vi.mock('../src/lib/roomApi', () => ({
  placeQuickPixel: vi.fn(),
  updateRoomDisplayName: vi.fn()
}));

const placeQuickPixelMock = vi.mocked(placeQuickPixel);
const updateRoomDisplayNameMock = vi.mocked(updateRoomDisplayName);

const landing: InviteLandingResponseDto = {
  roomPublicId: 'room_public_123',
  roomName: '금요일 친구들',
  todayDailyCanvasId: 'daily_123',
  canvasId: 'room_canvas_123',
  canvasSize: { width: 32, height: 32 },
  quickPixelSuggestion: { x: 16, y: 16, colorHex: '#38BDF8' }
};

const quickPixel: QuickPixelResponseDto = {
  accepted: true,
  roomPublicId: 'room_public_123',
  dailyCanvasId: 'daily_123',
  canvasId: 'room_canvas_123',
  x: 16,
  y: 16,
  colorHex: '#38BDF8',
  optionalNamePrompt: false,
  targetCompletionMs: 21_600_000,
  requiredPixelCount: 1024,
  effectiveParticipantCount: 4,
  dynamicAllowanceIntervalMs: 60_000,
  savedPixelCount: 0,
  maxSavedPixelCount: 12,
  nextPixelSavedAt: new Date().toISOString(),
  maxStorageEndsAt: new Date().toISOString()
};

describe('InviteQuickPixel', () => {
  afterEach(() => {
    cleanup();
    placeQuickPixelMock.mockReset();
    updateRoomDisplayNameMock.mockReset();
  });

  it('requires the invited user nickname before placing the first Quick Pixel', async () => {
    placeQuickPixelMock.mockResolvedValue(quickPixel);
    render(createElement(InviteQuickPixel, { landing, inviteToken: 'invite-token-123' }));

    expect(screen.getByRole('heading', { name: '금요일 친구들' })).toBeVisible();
    expect(screen.getByLabelText('내 닉네임')).toBeVisible();
    expect(screen.getByRole('button', { name: '퀵 픽셀 남기기' })).toHaveClass('primary-action');

    fireEvent.change(screen.getByLabelText('내 닉네임'), { target: { value: '준호' } });
    fireEvent.click(screen.getByRole('button', { name: '퀵 픽셀 남기기' }));

    await waitFor(() => {
      expect(placeQuickPixelMock).toHaveBeenCalledWith('room_public_123', {
        inviteToken: 'invite-token-123',
        suggestedColorHex: '#38BDF8',
        displayName: '준호'
      });
    });
    expect(screen.getByText('픽셀을 16,16에 남겼어요.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: '이름을 남길까요? 선택 사항이에요.' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '방으로 들어가기' })).toHaveAttribute(
      'href',
      '/r/room_public_123?inviteToken=invite-token-123'
    );
  });

  it('skips nickname input when the current browser session already has a nickname', async () => {
    placeQuickPixelMock.mockResolvedValue(quickPixel);
    render(createElement(InviteQuickPixel, {
      landing: { ...landing, participantDisplayName: '준호' },
      inviteToken: 'invite-token-123'
    }));

    expect(screen.queryByLabelText('내 닉네임')).not.toBeInTheDocument();
    expect(screen.getByText('준호 닉네임으로 바로 참여합니다.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '퀵 픽셀 남기기' }));

    await waitFor(() => {
      expect(placeQuickPixelMock).toHaveBeenCalledWith('room_public_123', {
        inviteToken: 'invite-token-123',
        suggestedColorHex: '#38BDF8'
      });
    });
  });

  it('suggests a same-IP nickname without skipping the nickname step', async () => {
    placeQuickPixelMock.mockResolvedValue(quickPixel);
    render(createElement(InviteQuickPixel, {
      landing: { ...landing, suggestedParticipantDisplayName: '준호' },
      inviteToken: 'invite-token-123'
    }));

    expect(screen.getByLabelText('내 닉네임')).toBeVisible();
    expect(screen.getByText('이 네트워크에서 준호 닉네임으로 참여한 기록이 있어요.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '준호로 계속하기' }));
    expect(screen.getByLabelText('내 닉네임')).toHaveValue('준호');

    fireEvent.click(screen.getByRole('button', { name: '퀵 픽셀 남기기' }));

    await waitFor(() => {
      expect(placeQuickPixelMock).toHaveBeenCalledWith('room_public_123', {
        inviteToken: 'invite-token-123',
        suggestedColorHex: '#38BDF8',
        displayName: '준호'
      });
    });
  });

  it('announces Quick Pixel loading and errors to assistive tech', async () => {
    placeQuickPixelMock.mockRejectedValue(new Error('expired'));
    render(createElement(InviteQuickPixel, { landing, inviteToken: 'invite-token-123' }));

    fireEvent.change(screen.getByLabelText('내 닉네임'), { target: { value: '준호' } });
    fireEvent.click(screen.getByRole('button', { name: '퀵 픽셀 남기기' }));

    expect(screen.getByRole('button', { name: '퀵 픽셀 남기는 중…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('퀵 픽셀을 남기는 중…');
    expect(await screen.findByRole('alert')).toHaveTextContent('픽셀을 남길 수 없습니다');
  });

  it('keeps optional name to 40 characters and skips locally without calling the API', () => {
    render(createElement(OptionalNamePrompt, { roomPublicId: 'room_public_123' }));

    expect(screen.getByLabelText('표시 이름(선택)')).toHaveAttribute('maxLength', '40');
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }));

    expect(updateRoomDisplayNameMock).not.toHaveBeenCalled();
    expect(screen.getByText('건너뛰었어요. 퀵 픽셀은 그대로 유지됩니다.')).toBeVisible();
  });

  it('announces optional name loading and save errors to assistive tech', async () => {
    updateRoomDisplayNameMock.mockRejectedValue(new Error('membership missing'));
    render(createElement(OptionalNamePrompt, { roomPublicId: 'room_public_123' }));

    fireEvent.change(screen.getByLabelText('표시 이름(선택)'), { target: { value: '민아' } });
    fireEvent.click(screen.getByRole('button', { name: '이름 저장' }));

    expect(screen.getByRole('button', { name: '이름 저장 중…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('선택한 이름을 저장하는 중…');
    expect(await screen.findByRole('alert')).toHaveTextContent('이름을 저장하지 못했습니다');
  });

  it('shows invalid invite as a closed friendly state', () => {
    render(createElement(InviteQuickPixel, { landing: null, inviteToken: 'expired-token' }));

    expect(screen.getByRole('heading', { name: '이 초대는 더 이상 열려 있지 않습니다' })).toBeVisible();
    expect(screen.getByText(/친구에게 새 링크를 요청하세요/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: '퀵 픽셀 남기기' })).not.toBeInTheDocument();
  });
});
