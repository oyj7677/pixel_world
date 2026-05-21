import type { HexColor } from './colors';
import type { PixelAllowanceStatePayload, PublicRecentPixelEvent } from './socketEvents';

export const FRIEND_ROOM_CANVAS_SIZE = { width: 32, height: 32 } as const;

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

export interface CreateRoomRequestDto {
  name: string;
  ownerDisplayName: string;
}

export interface CreateRoomResponseDto {
  roomPublicId: string;
  roomName: string;
  ownerDisplayName: string;
  todayDailyCanvasId: string;
  canvasId: string;
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
  canvasSize: typeof FRIEND_ROOM_CANVAS_SIZE;
  quickPixelSuggestion: QuickPixelSuggestionDto;
}

export interface QuickPixelRequestDto {
  inviteToken?: string;
  inviteCode?: string;
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
