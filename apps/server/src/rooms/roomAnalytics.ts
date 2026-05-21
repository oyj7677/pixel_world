import {
  privacySafeAnalyticsEventNames,
  type PrivacySafeAnalyticsEventName,
} from '@pixel-world/shared';
import type { DbClient } from '../db/index';
import { appendAnalyticsEvent } from './roomRepository';

const PRIVACY_SAFE_EVENT_NAMES = new Set<string>(
  privacySafeAnalyticsEventNames,
);

type AnalyticsPropertyValue = string | number | boolean | null;

type AnalyticsProperties = Record<string, AnalyticsPropertyValue>;

const PROPERTY_ALLOWLIST: Partial<
  Record<
    PrivacySafeAnalyticsEventName,
    Record<string, (value: AnalyticsPropertyValue) => boolean>
  >
> = {
  room_created: {
    canvasSize: (value) =>
      typeof value === 'string' && /^\d+x\d+$/.test(value),
    expectedParticipantCount: (value) =>
      typeof value === 'number' && Number.isFinite(value),
  },
  invite_link_created: {
    inviteRoute: (value) => value === '/i/:token' || value === '/invite/:token',
  },
  optional_display_name_set: {
    hasDisplayName: (value) => typeof value === 'boolean',
  },
  optional_display_name_skipped: {
    hasDisplayName: (value) => typeof value === 'boolean',
  },
};

export interface RoomAnalyticsEventInput {
  name: PrivacySafeAnalyticsEventName;
  roomId: string;
  roomPublicId: string;
  actorKey?: string | null;
  properties?: AnalyticsProperties;
}

function isPrivacySafeEventName(
  name: string,
): name is PrivacySafeAnalyticsEventName {
  return PRIVACY_SAFE_EVENT_NAMES.has(name);
}

function sanitizeProperties(
  eventName: PrivacySafeAnalyticsEventName,
  properties: AnalyticsProperties | undefined,
): AnalyticsProperties {
  const safeProperties: AnalyticsProperties = {};
  const allowedProperties = PROPERTY_ALLOWLIST[eventName] ?? {};

  for (const [key, value] of Object.entries(properties ?? {})) {
    const isAllowedValue = allowedProperties[key];
    if (isAllowedValue?.(value)) {
      safeProperties[key] = value;
    }
  }

  return safeProperties;
}

export async function recordRoomAnalyticsEvent(
  db: DbClient,
  event: RoomAnalyticsEventInput,
): Promise<void> {
  if (!isPrivacySafeEventName(event.name)) {
    throw new Error(`Unsupported room analytics event: ${event.name}`);
  }

  await appendAnalyticsEvent(db, {
    name: event.name,
    roomId: event.roomId,
    roomPublicId: event.roomPublicId,
    actorKey: event.actorKey ?? null,
    properties: sanitizeProperties(event.name, event.properties),
  });
}
