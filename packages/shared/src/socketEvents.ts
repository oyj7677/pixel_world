import type { HexColor } from './colors';

export interface PixelRecord {
  roomPublicId?: string;
  dailyCanvasId?: string;
  x: number;
  y: number;
  colorHex: HexColor;
  updatedAt: string;
}

export interface RecentPixelEvent {
  id: string;
  roomPublicId?: string;
  dailyCanvasId?: string;
  x: number;
  y: number;
  previousColorHex: HexColor | null;
  newColorHex: HexColor;
  actorKey: string;
  actorIpHash: string;
  source: 'user' | 'admin';
  createdAt: string;
}

export type PublicRecentPixelEvent = Omit<RecentPixelEvent, 'actorKey' | 'actorIpHash'>;

export interface PixelAllowanceStatePayload {
  targetCompletionMs: number;
  requiredPixelCount: number;
  effectiveParticipantCount: number;
  dynamicAllowanceIntervalMs: number;
  savedPixelCount: number;
  maxSavedPixelCount: number;
  nextPixelSavedAt: string;
  maxStorageEndsAt: string;
}

export interface CanvasSnapshotPayload {
  roomPublicId?: string;
  dailyCanvasId?: string;
  canvasId: string;
  width: number;
  height: number;
  defaultColorHex: HexColor;
  pixels: PixelRecord[];
  recentEvents: PublicRecentPixelEvent[];
  roomRecentEvents?: PublicRecentPixelEvent[];
  onlineCount: number;
  nextAvailableAt: string;
  pixelAllowance: PixelAllowanceStatePayload;
}

export interface PlacePixelPayload {
  roomPublicId?: string;
  dailyCanvasId?: string;
  canvasId: string;
  x: number;
  y: number;
  colorHex: string;
}

export interface PixelUpdatedPayload extends PixelRecord {
  canvasId: string;
}

export interface CooldownUpdatedPayload extends PixelAllowanceStatePayload {
  nextAvailableAt: string;
  remainingMs: number;
}

export interface PresenceUpdatedPayload {
  onlineCount: number;
}

export interface RecentEventsUpdatedPayload {
  roomPublicId?: string;
  dailyCanvasId?: string;
  events: PublicRecentPixelEvent[];
}

export interface PlacementRejectedPayload {
  reason:
    | 'invalid_canvas'
    | 'invalid_coordinate'
    | 'invalid_color'
    | 'cooldown_active'
    | 'blocked'
    | 'server_error';
  message: string;
  remainingMs?: number;
}

export interface ServerToClientEvents {
  canvasSnapshot: (payload: CanvasSnapshotPayload) => void;
  pixelUpdated: (payload: PixelUpdatedPayload) => void;
  presenceUpdated: (payload: PresenceUpdatedPayload) => void;
  recentEventsUpdated: (payload: RecentEventsUpdatedPayload) => void;
  roomRecentEventsUpdated: (payload: RecentEventsUpdatedPayload) => void;
  myRecentEventsUpdated: (payload: RecentEventsUpdatedPayload) => void;
  cooldownUpdated: (payload: CooldownUpdatedPayload) => void;
  placementRejected: (payload: PlacementRejectedPayload) => void;
}

export interface ClientToServerEvents {
  placePixel: (payload: PlacePixelPayload) => void;
}
