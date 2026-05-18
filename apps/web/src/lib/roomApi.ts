import type {
  CreateRoomRequestDto,
  CreateRoomInviteResponseDto,
  CreateRoomResponseDto,
  InviteLandingResponseDto,
  OptionalDisplayNameResponseDto,
  QuickPixelRequestDto,
  QuickPixelResponseDto
} from '@pixel-world/shared';

export interface RoomTodayResponseDto {
  roomPublicId: string;
  roomName?: string;
  todayDailyCanvasId: string;
  canvasId: string;
  canvasSize: { width: number; height: number };
}

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return readJson<T>(response);
}

export function createRoom(payload: CreateRoomRequestDto): Promise<CreateRoomResponseDto> {
  return requestJson<CreateRoomResponseDto>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function createRoomInvite(roomPublicId: string): Promise<CreateRoomInviteResponseDto> {
  return requestJson<CreateRoomInviteResponseDto>(`/api/rooms/${encodeURIComponent(roomPublicId)}/invites`, {
    method: 'POST'
  });
}

export async function getInviteLanding(inviteToken: string): Promise<InviteLandingResponseDto | null> {
  const response = await fetch(apiUrl(`/api/invites/${encodeURIComponent(inviteToken)}/landing`), {
    credentials: 'include',
    cache: 'no-store'
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Invite landing request failed with ${response.status}`);
  }

  return readJson<InviteLandingResponseDto>(response);
}

export function placeQuickPixel(
  roomPublicId: string,
  payload: QuickPixelRequestDto
): Promise<QuickPixelResponseDto> {
  return requestJson<QuickPixelResponseDto>(`/api/rooms/${encodeURIComponent(roomPublicId)}/quick-pixel`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateRoomDisplayName(
  roomPublicId: string,
  displayName: string
): Promise<OptionalDisplayNameResponseDto> {
  return requestJson<OptionalDisplayNameResponseDto>(`/api/rooms/${encodeURIComponent(roomPublicId)}/me`, {
    method: 'PATCH',
    body: JSON.stringify({ displayName })
  });
}

export async function getRoomToday(roomPublicId: string): Promise<RoomTodayResponseDto | null> {
  const response = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(roomPublicId)}/today`), {
    credentials: 'include',
    cache: 'no-store'
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Room today request failed with ${response.status}`);
  }

  return readJson<RoomTodayResponseDto>(response);
}
