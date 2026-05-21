import { createHash } from 'node:crypto';
import {
  calculateMaxSavedPixelCount,
  isValidRoomDisplayName,
  normalizeHexColor,
  type HexColor,
  type PixelAllowanceStatePayload,
  type QuickPixelResponseDto,
} from '@pixel-world/shared';
import { insertPixelIfEmptyAndLog, isActorBlocked } from '../db/canvasRepository';
import type { DbClient } from '../db/index';
import {
  checkAndConsumePixelAllowance,
  getUnlimitedPixelAllowanceState,
  type PixelAllowancePolicySnapshot,
  type PixelAllowanceResult,
  type PixelAllowanceStore,
  refundPixelAllowance,
} from '../services/pixelAllowanceService';
import {
  ensureRoomToday,
  ensureRoomMember,
  getActiveRoomMember,
  getRoomTodayIncludingArchived,
  validateInvite,
  validateInviteByCode,
  type DailyCanvasRecord,
  type InviteRecord,
  type RoomMemberRecord,
} from './roomRepository';
import { recordRoomAnalyticsEvent } from './roomAnalytics';

export type QuickPixelRejectedCode =
  | 'invalid_room'
  | 'invalid_invite'
  | 'room_archived'
  | 'room_inactive'
  | 'allowance_empty'
  | 'canvas_full'
  | 'invalid_color'
  | 'display_name_required'
  | 'blocked';

export class QuickPixelRejectedError extends Error {
  constructor(
    readonly code: QuickPixelRejectedCode,
    readonly friendlyMessage: string,
    readonly statusCode = code === 'allowance_empty' ? 429 : code === 'invalid_color' || code === 'display_name_required' ? 400 : code === 'canvas_full' ? 409 : code === 'blocked' ? 403 : 404,
    readonly allowance?: PixelAllowanceResult,
  ) {
    super(friendlyMessage);
    this.name = 'QuickPixelRejectedError';
  }
}

export interface PlaceQuickPixelInput {
  db: DbClient;
  allowanceStore: PixelAllowanceStore;
  inviteSecret: string;
  roomPublicId: string;
  actorKey: string;
  actorIpHash: string;
  inviteToken?: string | undefined;
  inviteCode?: string | undefined;
  displayName?: string | undefined;
  suggestedCoordinate?: { x: number; y: number } | undefined;
  suggestedColorHex?: string | undefined;
  unlimitedPixelPlacement?: boolean;
  nowMs?: number;
}

interface OccupiedCoordinateRow {
  x: number;
  y: number;
}

const DEFAULT_QUICK_PIXEL_COLOR: HexColor = '#38BDF8';

function roomAllowanceScopeKey(canvasId: string): string {
  return `canvas:${canvasId}`;
}

function allowancePolicyFromDailyCanvas(dailyCanvas: DailyCanvasRecord): PixelAllowancePolicySnapshot & {
  targetCompletionMs: number;
  requiredPixelCount: number;
  effectiveParticipantCount: number;
} {
  return {
    targetCompletionMs: dailyCanvas.targetCompletionMs,
    requiredPixelCount: dailyCanvas.requiredPixelCount,
    effectiveParticipantCount: dailyCanvas.expectedParticipantCount,
    dynamicAllowanceIntervalMs: dailyCanvas.pixelAllowanceIntervalMs,
    pixelAllowanceMaxStorageMs: dailyCanvas.pixelAllowanceMaxStorageMs,
    maxSavedPixelCount: calculateMaxSavedPixelCount({
      maxStorageMs: dailyCanvas.pixelAllowanceMaxStorageMs,
      allowanceIntervalMs: dailyCanvas.pixelAllowanceIntervalMs,
    }),
  };
}

function toAllowancePayload(
  policy: ReturnType<typeof allowancePolicyFromDailyCanvas>,
  allowance: PixelAllowanceResult,
): PixelAllowanceStatePayload {
  return {
    targetCompletionMs: policy.targetCompletionMs,
    requiredPixelCount: policy.requiredPixelCount,
    effectiveParticipantCount: policy.effectiveParticipantCount,
    dynamicAllowanceIntervalMs: policy.dynamicAllowanceIntervalMs,
    savedPixelCount: allowance.savedPixelCount,
    maxSavedPixelCount: allowance.maxSavedPixelCount,
    nextPixelSavedAt: new Date(allowance.nextPixelSavedAtMs).toISOString(),
    maxStorageEndsAt: new Date(allowance.maxStorageEndsAtMs).toISOString(),
  };
}

function isValidCoordinate(width: number, height: number, coordinate: { x: number; y: number } | undefined): coordinate is { x: number; y: number } {
  return (
    coordinate !== undefined &&
    Number.isInteger(coordinate.x) &&
    Number.isInteger(coordinate.y) &&
    coordinate.x >= 0 &&
    coordinate.x < width &&
    coordinate.y >= 0 &&
    coordinate.y < height
  );
}

function coordinateKey(x: number, y: number): string {
  return `${x},${y}`;
}

function deterministicOffset(totalCoordinates: number, seed: string): number {
  const digest = createHash('sha256').update(seed).digest('hex').slice(0, 12);
  return Number.parseInt(digest, 16) % totalCoordinates;
}

async function getOccupiedCoordinates(db: DbClient, canvasId: string): Promise<Set<string>> {
  const result = await db.query<OccupiedCoordinateRow>('SELECT x, y FROM pixels WHERE canvas_id = $1', [canvasId]);
  return new Set(result.rows.map((row) => coordinateKey(Number(row.x), Number(row.y))));
}

function scanCandidateCoordinates(input: {
  width: number;
  height: number;
  roomId: string;
  canvasDate: string;
  actorKey: string;
}): { x: number; y: number }[] {
  const totalCoordinates = input.width * input.height;
  const offset = deterministicOffset(totalCoordinates, `${input.roomId}:${input.canvasDate}:${input.actorKey}`);
  const candidates: { x: number; y: number }[] = [];

  for (let step = 0; step < totalCoordinates; step += 1) {
    const index = (offset + step) % totalCoordinates;
    candidates.push({
      x: index % input.width,
      y: Math.floor(index / input.width),
    });
  }

  return candidates;
}

async function getQuickPixelCoordinateCandidates(input: {
  db: DbClient;
  canvasId: string;
  width: number;
  height: number;
  roomId: string;
  canvasDate: string;
  actorKey: string;
  suggestedCoordinate?: { x: number; y: number } | undefined;
}): Promise<{ x: number; y: number }[]> {
  const occupied = await getOccupiedCoordinates(input.db, input.canvasId);
  const candidates: { x: number; y: number }[] = [];
  const seen = new Set<string>();

  function addIfEmpty(coordinate: { x: number; y: number }): void {
    const key = coordinateKey(coordinate.x, coordinate.y);
    if (!seen.has(key) && !occupied.has(key)) {
      seen.add(key);
      candidates.push(coordinate);
    }
  }

  if (isValidCoordinate(input.width, input.height, input.suggestedCoordinate)) {
    addIfEmpty(input.suggestedCoordinate);
  }

  for (const coordinate of scanCandidateCoordinates(input)) {
    addIfEmpty(coordinate);
  }

  return candidates;
}

async function getExistingMemberOrValidateInvite(input: {
  db: DbClient;
  roomId: string;
  actorKey: string;
  inviteToken?: string | undefined;
  inviteCode?: string | undefined;
  inviteSecret: string;
  displayName?: string | undefined;
}): Promise<
  | { existingMember: RoomMemberRecord; invite: null; resolvedDisplayName: string }
  | { existingMember: null; invite: InviteRecord; resolvedDisplayName: string }
> {
  const requestedDisplayName = normalizeDisplayName(input.displayName);
  const existingMember = await getActiveRoomMember(input.db, input.roomId, input.actorKey);
  if (existingMember) {
    const resolvedDisplayName = existingMember.displayName ?? requestedDisplayName;
    if (!resolvedDisplayName) {
      throw new QuickPixelRejectedError(
        'display_name_required',
        'Choose a nickname before placing your Quick Pixel.',
      );
    }

    return { existingMember, invite: null, resolvedDisplayName };
  }

  if (!input.inviteToken && !input.inviteCode) {
    throw new QuickPixelRejectedError('invalid_invite', 'Use a fresh invite link or room code to place your first Quick Pixel.');
  }

  const invite = input.inviteToken
    ? await validateInvite(input.db, input.inviteToken, input.inviteSecret)
    : await validateInviteByCode(input.db, input.inviteCode!, input.inviteSecret);
  if (!invite || invite.roomId !== input.roomId) {
    throw new QuickPixelRejectedError('invalid_invite', 'Use a fresh invite link or room code to place your first Quick Pixel.');
  }

  const resolvedDisplayName = requestedDisplayName;
  if (!resolvedDisplayName) {
    throw new QuickPixelRejectedError(
      'display_name_required',
      'Choose a nickname before placing your Quick Pixel.',
    );
  }

  return { existingMember: null, invite, resolvedDisplayName };
}

function normalizeDisplayName(displayName: string | undefined): string | null {
  if (displayName === undefined) {
    return null;
  }

  const trimmedDisplayName = displayName.trim();
  if (!isValidRoomDisplayName(trimmedDisplayName)) {
    return null;
  }

  return trimmedDisplayName;
}

async function consumeValidatedInviteUse(db: DbClient, input: {
  invite: InviteRecord;
  actorKey: string;
  actorIpHash: string;
}): Promise<InviteRecord> {
  const updateResult = await db.query<{
    id: string;
    room_id: string;
    created_by_member_id: string | null;
    role_on_join: 'owner' | 'admin' | 'member' | 'guest';
    max_uses: number | null;
    use_count: number;
    expires_at: Date | null;
    revoked_at: Date | null;
    created_at: Date;
  }>(
    `UPDATE room_invites
     SET use_count = use_count + 1
     WHERE id = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR use_count < max_uses)
     RETURNING id, room_id, created_by_member_id, role_on_join, max_uses, use_count,
               expires_at, revoked_at, created_at`,
    [input.invite.id],
  );
  const row = updateResult.rows[0];
  if (!row || row.room_id !== input.invite.roomId) {
    throw new QuickPixelRejectedError('invalid_invite', 'Use a fresh invite link to place your first Quick Pixel.');
  }

  await db.query(
    `INSERT INTO room_invite_uses (invite_id, room_id, actor_key, actor_ip_hash)
     VALUES ($1, $2, $3, $4)`,
    [row.id, row.room_id, input.actorKey, input.actorIpHash],
  );

  return {
    id: row.id,
    roomId: row.room_id,
    createdByMemberId: row.created_by_member_id,
    roleOnJoin: row.role_on_join,
    maxUses: row.max_uses === null ? null : Number(row.max_uses),
    useCount: Number(row.use_count),
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

async function withTransaction<T>(db: DbClient, callback: (client: DbClient) => Promise<T>): Promise<T> {
  const client = 'connect' in db ? await db.connect() : db;
  const shouldRelease = 'connect' in db;

  try {
    await client.query('BEGIN');
    const result = await callback(client as DbClient);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (shouldRelease) {
      (client as unknown as { release: () => void }).release();
    }
  }
}

export async function placeQuickPixel(input: PlaceQuickPixelInput): Promise<QuickPixelResponseDto> {
  const roomToday = (await getRoomTodayIncludingArchived(input.db, input.roomPublicId))
    ?? (await ensureRoomToday(input.db, input.roomPublicId));
  if (!roomToday) {
    throw new QuickPixelRejectedError('invalid_room', 'Room not found.');
  }
  if (roomToday.room.archivedAt) {
    throw new QuickPixelRejectedError('room_archived', 'This room is no longer accepting Quick Pixels.');
  }
  if (roomToday.dailyCanvas.status !== 'active') {
    throw new QuickPixelRejectedError('room_inactive', 'This room canvas is not accepting Quick Pixels right now.');
  }

  if (await isActorBlocked(input.db, {
    actorKey: input.actorKey,
    actorIpHash: input.actorIpHash,
    roomId: roomToday.room.id,
    dailyCanvasId: roomToday.dailyCanvas.id,
    canvasId: roomToday.canvas.id,
  })) {
    throw new QuickPixelRejectedError('blocked', 'Quick Pixel placement is blocked for this actor.', 403);
  }

  const colorHex = normalizeHexColor(input.suggestedColorHex ?? DEFAULT_QUICK_PIXEL_COLOR);
  if (!colorHex) {
    throw new QuickPixelRejectedError('invalid_color', 'Choose a valid Quick Pixel color.');
  }

  const candidates = await getQuickPixelCoordinateCandidates({
    db: input.db,
    canvasId: roomToday.canvas.id,
    width: roomToday.canvas.width,
    height: roomToday.canvas.height,
    roomId: roomToday.room.id,
    canvasDate: roomToday.dailyCanvas.canvasDate,
    actorKey: input.actorKey,
    suggestedCoordinate: input.suggestedCoordinate,
  });
  if (candidates.length === 0) {
    throw new QuickPixelRejectedError('canvas_full', 'This canvas is full. Try tomorrow’s room canvas.');
  }

  const membershipOrInvite = await getExistingMemberOrValidateInvite({
    db: input.db,
    roomId: roomToday.room.id,
    actorKey: input.actorKey,
    inviteToken: input.inviteToken,
    inviteCode: input.inviteCode,
    inviteSecret: input.inviteSecret,
    displayName: input.displayName,
  });

  const policy = allowancePolicyFromDailyCanvas(roomToday.dailyCanvas);
  const nowMs = input.nowMs ?? Date.now();
  const allowance = input.unlimitedPixelPlacement
    ? getUnlimitedPixelAllowanceState(nowMs, policy)
    : await checkAndConsumePixelAllowance(
        input.allowanceStore,
        roomAllowanceScopeKey(roomToday.canvas.id),
        input.actorKey,
        nowMs,
        policy,
      );

  if (!allowance.allowed) {
    throw new QuickPixelRejectedError(
      'allowance_empty',
      'No Quick Pixels are ready yet. Please try again soon.',
      429,
      allowance,
    );
  }

  let placement: {
    event: Awaited<ReturnType<typeof insertPixelIfEmptyAndLog>> extends infer T ? NonNullable<T> : never;
    optionalNamePrompt: boolean;
  };
  try {
    placement = await withTransaction(input.db, async (client) => {
      const member = membershipOrInvite.existingMember
        ? await ensureRoomMember(client, {
            roomId: roomToday.room.id,
            actorKey: input.actorKey,
            role: membershipOrInvite.existingMember.role,
            inviteId: membershipOrInvite.existingMember.joinedViaInviteId,
            displayName: membershipOrInvite.resolvedDisplayName,
          })
        : await (async () => {
        const consumedInvite = await consumeValidatedInviteUse(client, {
          invite: membershipOrInvite.invite,
          actorKey: input.actorKey,
          actorIpHash: input.actorIpHash,
        });
        return ensureRoomMember(client, {
          roomId: roomToday.room.id,
          actorKey: input.actorKey,
          role: consumedInvite.roleOnJoin,
          inviteId: consumedInvite.id,
          displayName: membershipOrInvite.resolvedDisplayName,
        });
      })();

      for (const candidate of candidates) {
        const event = await insertPixelIfEmptyAndLog(client, {
          canvasId: roomToday.canvas.id,
          x: candidate.x,
          y: candidate.y,
          colorHex,
          actorKey: input.actorKey,
          actorIpHash: input.actorIpHash,
          source: 'user',
        });
        if (event) {
          await recordRoomAnalyticsEvent(client, {
            name: 'recipient_first_pixel_completed',
            roomId: roomToday.room.id,
            roomPublicId: roomToday.room.publicId,
            actorKey: input.actorKey,
          });
          return { event, optionalNamePrompt: member.displayName === null };
        }
      }

      throw new QuickPixelRejectedError('canvas_full', 'This canvas is full. Try tomorrow’s room canvas.');
    });
  } catch (error) {
    if (!input.unlimitedPixelPlacement) {
      await refundPixelAllowance(input.allowanceStore, roomAllowanceScopeKey(roomToday.canvas.id), input.actorKey, Date.now(), policy);
    }
    throw error;
  }

  return {
    accepted: true,
    roomPublicId: roomToday.room.publicId,
    dailyCanvasId: roomToday.dailyCanvas.id,
    canvasId: roomToday.canvas.id,
    x: placement.event.x,
    y: placement.event.y,
    colorHex,
    optionalNamePrompt: placement.optionalNamePrompt,
    ...toAllowancePayload(policy, allowance),
    recentEvents: [
      {
        id: placement.event.id,
        x: placement.event.x,
        y: placement.event.y,
        previousColorHex: placement.event.previousColorHex,
        newColorHex: placement.event.newColorHex,
        source: placement.event.source,
        createdAt: placement.event.createdAt,
      },
    ],
  };
}
