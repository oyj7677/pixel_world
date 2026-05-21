import type { HexColor } from './colors';
import type { PixelAllowanceStatePayload, PublicRecentPixelEvent } from './socketEvents';

export const FRIEND_ROOM_DEFAULT_CANVAS_DIMENSION = 48;
export const FRIEND_ROOM_MIN_CANVAS_DIMENSION = 16;
export const FRIEND_ROOM_MAX_CANVAS_DIMENSION = 64;
export const FRIEND_ROOM_CANVAS_SIZE = {
  width: FRIEND_ROOM_DEFAULT_CANVAS_DIMENSION,
  height: FRIEND_ROOM_DEFAULT_CANVAS_DIMENSION,
} as const;
export const FRIEND_ROOM_CANVAS_DIMENSION_PRESETS = [
  {
    id: 'small',
    label: '작게',
    dimension: FRIEND_ROOM_DEFAULT_CANVAS_DIMENSION,
    description: '가볍게 시작하기 좋아요.',
  },
  {
    id: 'medium',
    label: '중간',
    dimension: 56,
    description: '여럿이 칠하기 적당해요.',
  },
  {
    id: 'large',
    label: '크게',
    dimension: FRIEND_ROOM_MAX_CANVAS_DIMENSION,
    description: '더 넓게 그리고 싶을 때 좋아요.',
  },
] as const;

export const FRIEND_ROOM_DEFAULT_TARGET_COMPLETION_MS = 6 * 60 * 60 * 1000;
export const FRIEND_ROOM_MAX_TARGET_COMPLETION_MS = 24 * 60 * 60 * 1000 - 1;
export const FRIEND_ROOM_MAX_NAME_LENGTH = 80;
export const FRIEND_ROOM_MAX_DISPLAY_NAME_LENGTH = 40;
export const FRIEND_ROOM_INVITE_CODE_LENGTH = 4;

export const FRIEND_ROOM_ROUTES = {
  room: (publicId: string): string => `/r/${publicId}`,
  invite: (token: string): string => `/i/${token}`,
  inviteCode: (code: string): string => `/c/${code}`,
  legacyInvite: (token: string): string => `/invite/${token}`
} as const;

const INVITE_CODE_PATTERN = /^[A-Z0-9]{4}$/;

export function normalizeInviteCode(inviteCode: string): string | null {
  const normalized = inviteCode.trim().toUpperCase().replaceAll(/[\s-]/g, '');
  return INVITE_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function isValidRoomName(name: string): boolean {
  const trimmedName = name.trim();
  return trimmedName.length >= 1 && trimmedName.length <= FRIEND_ROOM_MAX_NAME_LENGTH;
}

export function isValidRoomDisplayName(displayName: string): boolean {
  const trimmedDisplayName = displayName.trim();
  return trimmedDisplayName.length >= 1 && trimmedDisplayName.length <= FRIEND_ROOM_MAX_DISPLAY_NAME_LENGTH;
}

export function isValidRoomCanvasDimension(canvasDimension: number): boolean {
  return (
    Number.isInteger(canvasDimension) &&
    canvasDimension >= FRIEND_ROOM_MIN_CANVAS_DIMENSION &&
    canvasDimension <= FRIEND_ROOM_MAX_CANVAS_DIMENSION
  );
}

export interface CreateRoomRequestDto {
  name: string;
  ownerDisplayName: string;
  canvasDimension?: number;
}

export interface CreateRoomResponseDto {
  roomPublicId: string;
  roomName: string;
  ownerDisplayName: string;
  todayDailyCanvasId: string;
  canvasId: string;
  canvasSize: { width: number; height: number };
  inviteUrl: string;
  inviteCode: string;
}

export interface CreateRoomInviteResponseDto {
  roomPublicId: string;
  inviteUrl: string;
  inviteCode: string;
}

export interface QuickPixelSuggestionDto {
  x: number;
  y: number;
  colorHex?: HexColor;
}

export interface InviteLandingResponseDto {
  roomPublicId: string;
  roomName: string;
  inviterDisplayName?: string;
  participantDisplayName?: string;
  suggestedParticipantDisplayName?: string;
  todayDailyCanvasId: string;
  canvasId: string;
  canvasSize: { width: number; height: number };
  quickPixelSuggestion: QuickPixelSuggestionDto;
}

export interface QuickPixelRequestDto {
  inviteToken?: string;
  inviteCode?: string;
  suggestedCoordinate?: { x: number; y: number };
  suggestedColorHex?: HexColor;
  displayName?: string;
}

export interface QuickPixelResponseDto extends PixelAllowanceStatePayload {
  accepted: true;
  roomPublicId: string;
  dailyCanvasId: string;
  canvasId: string;
  x: number;
  y: number;
  colorHex: HexColor;
  optionalNamePrompt: boolean;
  recentEvents?: PublicRecentPixelEvent[];
}

export interface OptionalDisplayNameRequestDto {
  displayName?: string;
}

export interface OptionalDisplayNameResponseDto {
  roomPublicId: string;
  displayName: string | null;
}

export const privacySafeAnalyticsEventNames = [
  'room_created',
  'invite_link_created',
  'invite_link_copied',
  'invite_landing_viewed',
  'recipient_quick_pixel_started',
  'recipient_first_pixel_completed',
  'recipient_first_pixel_abandoned',
  'optional_display_name_viewed',
  'optional_display_name_set',
  'optional_display_name_skipped'
] as const;

export type PrivacySafeAnalyticsEventName = (typeof privacySafeAnalyticsEventNames)[number];

export interface PrivacySafeAnalyticsEventDto {
  name: PrivacySafeAnalyticsEventName;
  roomPublicId: string;
  occurredAt: string;
  properties?: Record<string, string | number | boolean | null>;
}
