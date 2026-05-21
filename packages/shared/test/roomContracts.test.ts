import { describe, expect, it } from 'vitest';
import {
  FRIEND_ROOM_CANVAS_SIZE,
  FRIEND_ROOM_ROUTES,
  isValidRoomName,
  privacySafeAnalyticsEventNames
} from '../src/roomContracts';

describe('room contracts', () => {
  it('fixes the Phase-1 canvas size at 32 by 32', () => {
    expect(FRIEND_ROOM_CANVAS_SIZE).toEqual({ width: 32, height: 32 });
  });

  it('accepts short human room names and rejects empty names', () => {
    expect(isValidRoomName('Mina birthday')).toBe(true);
    expect(isValidRoomName('')).toBe(false);
    expect(isValidRoomName('   ')).toBe(false);
  });

  it('defines stable public routes for room and invite flows', () => {
    expect(FRIEND_ROOM_ROUTES.room('abc123')).toBe('/r/abc123');
    expect(FRIEND_ROOM_ROUTES.invite('token123')).toBe('/i/token123');
    expect(FRIEND_ROOM_ROUTES.legacyInvite('token123')).toBe('/invite/token123');
  });

  it('keeps analytics event names in the Phase-1 privacy-safe set', () => {
    expect(privacySafeAnalyticsEventNames).toContain('room_created');
    expect(privacySafeAnalyticsEventNames).toContain('recipient_first_pixel_completed');
  });
});
