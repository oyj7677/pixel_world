// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveRoomPixelTemplateRequestDto } from '@pixel-world/shared';
import { RoomPixelTemplatePanel } from '../src/components/RoomPixelTemplatePanel';
import { pixelizeImageFile } from '../src/lib/imagePixelizer';
import { saveRoomPixelTemplate } from '../src/lib/roomApi';

vi.mock('../src/lib/imagePixelizer', () => ({
  pixelizeImageFile: vi.fn(async () => ({
    width: 2,
    height: 2,
    defaultColorHex: '#FFFFFF',
    pixels: [{ x: 1, y: 0, colorHex: '#22C55E' }]
  }))
}));

vi.mock('../src/lib/roomApi', () => ({
  saveRoomPixelTemplate: vi.fn(async (_roomPublicId: string, payload: SaveRoomPixelTemplateRequestDto) => ({
    template: {
      id: 'template-1',
      roomPublicId: 'room_public_123',
      ...payload,
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z'
    }
  }))
}));

describe('RoomPixelTemplatePanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('lets owners pixelize an image and save only the pixel template payload', async () => {
    const onTemplateSaved = vi.fn();
    const onStatus = vi.fn();

    const { container } = render(createElement(RoomPixelTemplatePanel, {
      roomPublicId: 'room_public_123',
      canvasWidth: 2,
      canvasHeight: 2,
      defaultColorHex: '#FFFFFF',
      template: null,
      isOwner: true,
      onTemplateSaved,
      onStatus
    }));

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['original'], 'team-logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('img', { name: 'team-logo 저장 전 픽셀 샘플' })).toBeVisible();
    expect(pixelizeImageFile).toHaveBeenCalledWith(file, {
      targetWidth: 2,
      targetHeight: 2,
      defaultColorHex: '#FFFFFF'
    });

    fireEvent.click(screen.getByRole('button', { name: '샘플 저장' }));

    await waitFor(() => expect(saveRoomPixelTemplate).toHaveBeenCalledTimes(1));
    expect(saveRoomPixelTemplate).toHaveBeenCalledWith('room_public_123', {
      name: 'team-logo',
      width: 2,
      height: 2,
      defaultColorHex: '#FFFFFF',
      pixels: [{ x: 1, y: 0, colorHex: '#22C55E' }]
    });
    expect(JSON.stringify(vi.mocked(saveRoomPixelTemplate).mock.calls[0])).not.toContain('original');
    expect(onTemplateSaved).toHaveBeenCalledWith(expect.objectContaining({
      id: 'template-1',
      name: 'team-logo',
      pixels: [{ x: 1, y: 0, colorHex: '#22C55E' }]
    }));
    expect(onStatus).toHaveBeenCalledWith('공유 샘플을 저장했어요.');
  });

  it('shows shared templates to members without owner upload controls', () => {
    render(createElement(RoomPixelTemplatePanel, {
      roomPublicId: 'room_public_123',
      canvasWidth: 2,
      canvasHeight: 2,
      defaultColorHex: '#FFFFFF',
      template: {
        id: 'template-1',
        roomPublicId: 'room_public_123',
        name: '함께 그릴 샘플',
        width: 2,
        height: 2,
        defaultColorHex: '#FFFFFF',
        pixels: [{ x: 0, y: 1, colorHex: '#38BDF8' }],
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z'
      },
      isOwner: false,
      onTemplateSaved: vi.fn()
    }));

    expect(screen.getByRole('img', { name: '함께 그릴 샘플 공유 픽셀 샘플' })).toBeVisible();
    expect(screen.queryByText('이미지 선택')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '샘플 저장' })).not.toBeInTheDocument();
  });
});
