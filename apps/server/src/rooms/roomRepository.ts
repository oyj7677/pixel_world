import {
  DEFAULT_COOLDOWN_MS,
  FRIEND_ROOM_DEFAULT_CANVAS_DIMENSION,
  FRIEND_ROOM_DEFAULT_TARGET_COMPLETION_MS,
  DEFAULT_PIXEL_ALLOWANCE_MAX_STORAGE_MS,
  calculateDynamicAllowanceIntervalMs,
  calculateRequiredPixelCount,
  isValidRoomCanvasDimension,
  normalizeInviteCode
} from '@pixel-world/shared';
import type { DbClient } from '../db/index';
import { generateInviteCode, generateInviteToken, hashInviteToken, verifyInviteToken } from './inviteTokens';

type RoomRole = 'owner' | 'admin' | 'member' | 'guest';
type RoomPrivacy = 'private' | 'unlisted';
type DailyCanvasStatus = 'scheduled' | 'active' | 'sealed' | 'replay_ready';

const MAX_INVITE_CREDENTIAL_ATTEMPTS = 12;

export interface RoomRecord {
  id: string;
  publicId: string;
  name: string;
  privacy: RoomPrivacy;
  ownerActorKey: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultCooldownMs: number;
  targetCompletionMs: number;
  expectedParticipantCount: number;
  pixelAllowanceIntervalMs: number;
  pixelAllowanceMaxStorageMs: number;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface RoomMemberRecord {
  id: string;
  roomId: string;
  actorKey: string;
  displayName: string | null;
  displayColor: string | null;
  role: RoomRole;
  state: 'active' | 'left' | 'blocked';
  joinedViaInviteId: string | null;
  joinedAt: string;
  lastSeenAt: string | null;
}

export interface InviteRecord {
  id: string;
  roomId: string;
  createdByMemberId: string | null;
  roleOnJoin: RoomRole;
  maxUses: number | null;
  useCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedInvite extends InviteRecord {
  rawToken: string;
  rawCode: string;
}

export interface CanvasRecord {
  id: string;
  slug: string;
  width: number;
  height: number;
  kind: 'global' | 'room_daily' | null;
}

export interface DailyCanvasRecord {
  id: string;
  roomId: string;
  canvasDate: string;
  canvasId: string;
  status: DailyCanvasStatus;
  width: number;
  height: number;
  targetCompletionMs: number;
  expectedParticipantCount: number;
  requiredPixelCount: number;
  pixelAllowanceIntervalMs: number;
  pixelAllowanceMaxStorageMs: number;
  openedAt: string;
}

export interface CreateRoomWithTodayCanvasInput {
  name: string;
  ownerActorKey: string;
  ownerDisplayName?: string | null;
  inviteSecret: string;
  publicIdPrefix?: string;
  today?: Date;
  timezone?: string;
  expectedParticipantCount?: number;
  targetCompletionMs?: number;
  pixelAllowanceMaxStorageMs?: number;
  canvasDimension?: number;
}

export interface CreatedRoomWithTodayCanvas {
  room: RoomRecord;
  ownerMember: RoomMemberRecord;
  invite: CreatedInvite;
  canvas: CanvasRecord;
  dailyCanvas: DailyCanvasRecord;
}

export interface CreateInviteInput {
  roomId: string;
  createdByMemberId: string;
  inviteSecret: string;
  roleOnJoin?: RoomRole;
  maxUses?: number | null;
  expiresAt?: Date | null;
}

export interface EnsureRoomMemberInput {
  roomId: string;
  actorKey: string;
  role: RoomRole;
  inviteId?: string | null;
  displayName?: string | null;
}

export interface ConsumeInviteUseInput {
  rawToken: string;
  inviteSecret: string;
  actorKey: string;
  actorIpHash?: string | null;
}

export interface AnalyticsEventInput {
  name: string;
  roomId?: string | null;
  roomPublicId?: string | null;
  actorKey?: string | null;
  properties?: Record<string, string | number | boolean | null>;
  occurredAt?: Date;
}

interface RoomRow {
  id: string;
  public_id: string;
  name: string;
  privacy: RoomPrivacy;
  owner_actor_key: string;
  default_width: number;
  default_height: number;
  default_cooldown_ms: number;
  target_completion_ms: number;
  expected_participant_count: number;
  pixel_allowance_interval_ms: number;
  pixel_allowance_max_storage_ms: number;
  timezone: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

interface MemberRow {
  id: string;
  room_id: string;
  actor_key: string;
  display_name: string | null;
  display_color: string | null;
  role: RoomRole;
  state: 'active' | 'left' | 'blocked';
  joined_via_invite_id: string | null;
  joined_at: Date;
  last_seen_at: Date | null;
}

interface InviteRow {
  id: string;
  room_id: string;
  created_by_member_id: string | null;
  role_on_join: RoomRole;
  max_uses: number | null;
  use_count: number;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

interface CanvasRow {
  id: string;
  slug: string;
  width: number;
  height: number;
  kind: 'global' | 'room_daily' | null;
}

interface DailyCanvasRow {
  id: string;
  room_id: string;
  canvas_date: Date | string;
  canvas_id: string;
  status: DailyCanvasStatus;
  width: number;
  height: number;
  target_completion_ms: number;
  expected_participant_count: number;
  required_pixel_count: number;
  pixel_allowance_interval_ms: number;
  pixel_allowance_max_storage_ms: number;
  opened_at: Date;
}

function mapRoom(row: RoomRow): RoomRecord {
  return {
    id: row.id,
    publicId: row.public_id,
    name: row.name,
    privacy: row.privacy,
    ownerActorKey: row.owner_actor_key,
    defaultWidth: Number(row.default_width),
    defaultHeight: Number(row.default_height),
    defaultCooldownMs: Number(row.default_cooldown_ms),
    targetCompletionMs: Number(row.target_completion_ms),
    expectedParticipantCount: Number(row.expected_participant_count),
    pixelAllowanceIntervalMs: Number(row.pixel_allowance_interval_ms),
    pixelAllowanceMaxStorageMs: Number(row.pixel_allowance_max_storage_ms),
    timezone: row.timezone,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: row.archived_at?.toISOString() ?? null
  };
}

function mapMember(row: MemberRow): RoomMemberRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    actorKey: row.actor_key,
    displayName: row.display_name,
    displayColor: row.display_color,
    role: row.role,
    state: row.state,
    joinedViaInviteId: row.joined_via_invite_id,
    joinedAt: row.joined_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null
  };
}

function mapInvite(row: InviteRow): InviteRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    createdByMemberId: row.created_by_member_id,
    roleOnJoin: row.role_on_join,
    maxUses: row.max_uses === null ? null : Number(row.max_uses),
    useCount: Number(row.use_count),
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

function mapCanvas(row: CanvasRow): CanvasRecord {
  return {
    id: row.id,
    slug: row.slug,
    width: Number(row.width),
    height: Number(row.height),
    kind: row.kind
  };
}

function mapDailyCanvas(row: DailyCanvasRow): DailyCanvasRecord {
  const canvasDate = dateOnlyToString(row.canvas_date);
  return {
    id: row.id,
    roomId: row.room_id,
    canvasDate,
    canvasId: row.canvas_id,
    status: row.status,
    width: Number(row.width),
    height: Number(row.height),
    targetCompletionMs: Number(row.target_completion_ms),
    expectedParticipantCount: Number(row.expected_participant_count),
    requiredPixelCount: Number(row.required_pixel_count),
    pixelAllowanceIntervalMs: Number(row.pixel_allowance_interval_ms),
    pixelAllowanceMaxStorageMs: Number(row.pixel_allowance_max_storage_ms),
    openedAt: row.opened_at.toISOString()
  };
}

function generatePublicId(prefix?: string): string {
  const suffix = generateInviteToken(12);
  return prefix ? `${prefix}-${suffix}` : `room_${suffix}`;
}

async function insertInviteWithGeneratedCredentials(
  db: DbClient,
  input: {
    roomId: string;
    createdByMemberId: string;
    inviteSecret: string;
    roleOnJoin?: RoomRole;
    maxUses?: number | null;
    expiresAt?: Date | null;
  },
): Promise<CreatedInvite> {
  for (let attempt = 0; attempt < MAX_INVITE_CREDENTIAL_ATTEMPTS; attempt += 1) {
    const rawToken = generateInviteToken();
    const rawCode = generateInviteCode();
    const codeHash = hashInviteToken(rawToken, input.inviteSecret);
    const shortCodeHash = hashInviteToken(rawCode, input.inviteSecret);
    const result = await db.query<InviteRow>(
      `INSERT INTO room_invites (room_id, code_hash, short_code_hash, created_by_member_id, role_on_join, max_uses, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING id, room_id, created_by_member_id, role_on_join, max_uses, use_count,
                 expires_at, revoked_at, created_at`,
      [
        input.roomId,
        codeHash,
        shortCodeHash,
        input.createdByMemberId,
        input.roleOnJoin ?? 'guest',
        input.maxUses ?? null,
        input.expiresAt ?? null,
      ],
    );

    const row = result.rows[0];
    if (row) {
      return { ...mapInvite(row), rawToken, rawCode };
    }
  }

  throw new Error('Failed to generate a unique room invite code.');
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function dateOnlyToString(value: Date | string): string {
  if (typeof value === 'string') {
    return value;
  }

  return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

function dateInTimeZone(input: Date | undefined, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(input ?? new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function compactDate(date: string): string {
  return date.replaceAll('-', '');
}

async function createOrGetDailyCanvasForRoom(
  db: DbClient,
  room: RoomRecord,
  canvasDate: string,
): Promise<{
  dailyCanvas: DailyCanvasRecord;
  canvas: CanvasRecord;
}> {
  const width = room.defaultWidth;
  const height = room.defaultHeight;
  const requiredPixelCount = calculateRequiredPixelCount({ width, height });
  const canvasId = `room_${room.publicId}_${compactDate(canvasDate)}`;

  const canvasResult = await db.query<CanvasRow>(
    `INSERT INTO canvases (id, slug, width, height, kind)
     VALUES ($1, $1, $2, $3, 'room_daily')
     ON CONFLICT (id)
     DO UPDATE SET width = EXCLUDED.width,
                   height = EXCLUDED.height,
                   kind = EXCLUDED.kind,
                   updated_at = now()
     RETURNING id, slug, width, height, kind`,
    [canvasId, width, height],
  );
  const canvas = mapCanvas(canvasResult.rows[0]!);

  const dailyCanvasResult = await db.query<DailyCanvasRow>(
    `INSERT INTO daily_canvases
       (room_id, canvas_date, canvas_id, status, width, height, cooldown_ms, target_completion_ms,
        expected_participant_count, required_pixel_count, pixel_allowance_interval_ms,
        pixel_allowance_max_storage_ms, opened_at)
     VALUES ($1, $2::date, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, now())
     ON CONFLICT (room_id, canvas_date)
     DO UPDATE SET opened_at = daily_canvases.opened_at
     RETURNING id, room_id, canvas_date, canvas_id, status, width, height, target_completion_ms,
               expected_participant_count, required_pixel_count, pixel_allowance_interval_ms,
               pixel_allowance_max_storage_ms, opened_at`,
    [
      room.id,
      canvasDate,
      canvas.id,
      width,
      height,
      room.defaultCooldownMs,
      room.targetCompletionMs,
      room.expectedParticipantCount,
      requiredPixelCount,
      room.pixelAllowanceIntervalMs,
      room.pixelAllowanceMaxStorageMs,
    ],
  );

  return {
    canvas,
    dailyCanvas: mapDailyCanvas(dailyCanvasResult.rows[0]!),
  };
}

export async function createRoomWithTodayCanvas(
  db: DbClient,
  input: CreateRoomWithTodayCanvasInput
): Promise<CreatedRoomWithTodayCanvas> {
  const client = 'connect' in db ? await db.connect() : db;
  const shouldRelease = 'connect' in db;
  const canvasDimension = input.canvasDimension ?? FRIEND_ROOM_DEFAULT_CANVAS_DIMENSION;
  if (!isValidRoomCanvasDimension(canvasDimension)) {
    throw new Error('invalid_room_canvas_dimension');
  }
  const width = canvasDimension;
  const height = canvasDimension;
  const requiredPixelCount = calculateRequiredPixelCount({ width, height });
  const targetCompletionMs = input.targetCompletionMs ?? FRIEND_ROOM_DEFAULT_TARGET_COMPLETION_MS;
  const expectedParticipantCount = input.expectedParticipantCount ?? 4;
  const pixelAllowanceIntervalMs = calculateDynamicAllowanceIntervalMs({
    targetCompletionMs,
    effectiveParticipantCount: expectedParticipantCount,
    requiredPixelCount
  });
  const pixelAllowanceMaxStorageMs = input.pixelAllowanceMaxStorageMs ?? DEFAULT_PIXEL_ALLOWANCE_MAX_STORAGE_MS;
  const timezone = input.timezone ?? 'Asia/Seoul';
  const canvasDate = dateInTimeZone(input.today, timezone);

  try {
    await client.query('BEGIN');

    const roomResult = await client.query<RoomRow>(
      `INSERT INTO rooms
       (public_id, name, privacy, owner_actor_key, default_width, default_height, default_cooldown_ms,
        target_completion_ms, expected_participant_count, pixel_allowance_interval_ms,
        pixel_allowance_max_storage_ms, timezone)
       VALUES ($1, $2, 'private', $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, public_id, name, privacy, owner_actor_key, default_width, default_height,
                 default_cooldown_ms, target_completion_ms, expected_participant_count,
                 pixel_allowance_interval_ms, pixel_allowance_max_storage_ms, timezone,
                 created_at, updated_at, archived_at`,
      [
        generatePublicId(input.publicIdPrefix),
        input.name.trim(),
        input.ownerActorKey,
        width,
        height,
        DEFAULT_COOLDOWN_MS,
        targetCompletionMs,
        expectedParticipantCount,
        pixelAllowanceIntervalMs,
        pixelAllowanceMaxStorageMs,
        timezone
      ]
    );
    const room = mapRoom(roomResult.rows[0]!);

    const memberResult = await client.query<MemberRow>(
      `INSERT INTO room_members (room_id, actor_key, display_name, role, state, last_seen_at)
       VALUES ($1, $2, $3, 'owner', 'active', now())
       RETURNING id, room_id, actor_key, display_name, display_color, role, state,
                 joined_via_invite_id, joined_at, last_seen_at`,
      [room.id, input.ownerActorKey, input.ownerDisplayName ?? null]
    );
    const ownerMember = mapMember(memberResult.rows[0]!);

    const { canvas, dailyCanvas } = await createOrGetDailyCanvasForRoom(client as DbClient, room, canvasDate);

    const invite = await insertInviteWithGeneratedCredentials(client as DbClient, {
      roomId: room.id,
      createdByMemberId: ownerMember.id,
      inviteSecret: input.inviteSecret,
    });

    await client.query('COMMIT');
    return { room, ownerMember, invite, canvas, dailyCanvas };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (shouldRelease) {
      (client as unknown as { release: () => void }).release();
    }
  }
}

interface RoomTodayRow extends RoomRow {
  daily_canvas_id: string;
  daily_room_id: string;
  daily_canvas_date: Date | string;
  daily_canvas_id_text: string;
  daily_status: DailyCanvasStatus;
  daily_width: number;
  daily_height: number;
  daily_target_completion_ms: number;
  daily_expected_participant_count: number;
  daily_required_pixel_count: number;
  daily_pixel_allowance_interval_ms: number;
  daily_pixel_allowance_max_storage_ms: number;
  daily_opened_at: Date;
  canvas_id_text: string;
  canvas_slug: string;
  canvas_width: number;
  canvas_height: number;
  canvas_kind: 'global' | 'room_daily' | null;
}

function mapRoomToday(row: RoomTodayRow): {
  room: RoomRecord;
  dailyCanvas: DailyCanvasRecord;
  canvas: CanvasRecord;
} {
  return {
    room: mapRoom(row),
    dailyCanvas: mapDailyCanvas({
      id: row.daily_canvas_id,
      room_id: row.daily_room_id,
      canvas_date: row.daily_canvas_date,
      canvas_id: row.daily_canvas_id_text,
      status: row.daily_status,
      width: row.daily_width,
      height: row.daily_height,
      target_completion_ms: row.daily_target_completion_ms,
      expected_participant_count: row.daily_expected_participant_count,
      required_pixel_count: row.daily_required_pixel_count,
      pixel_allowance_interval_ms: row.daily_pixel_allowance_interval_ms,
      pixel_allowance_max_storage_ms: row.daily_pixel_allowance_max_storage_ms,
      opened_at: row.daily_opened_at
    }),
    canvas: mapCanvas({
      id: row.canvas_id_text,
      slug: row.canvas_slug,
      width: row.canvas_width,
      height: row.canvas_height,
      kind: row.canvas_kind
    })
  };
}

async function getRoomTodayByWhere(
  db: DbClient,
  whereClause: 'r.public_id = $1' | 'r.id = $1',
  value: string,
  options: { includeArchived?: boolean } = {}
): Promise<{
  room: RoomRecord;
  dailyCanvas: DailyCanvasRecord;
  canvas: CanvasRecord;
} | null> {
  const result = await db.query<RoomTodayRow>(
    `SELECT
       r.id, r.public_id, r.name, r.privacy, r.owner_actor_key, r.default_width, r.default_height,
       r.default_cooldown_ms, r.target_completion_ms, r.expected_participant_count,
       r.pixel_allowance_interval_ms, r.pixel_allowance_max_storage_ms, r.timezone,
       r.created_at, r.updated_at, r.archived_at,
       dc.id AS daily_canvas_id, dc.room_id AS daily_room_id, dc.canvas_date AS daily_canvas_date,
       dc.canvas_id AS daily_canvas_id_text, dc.status AS daily_status,
       dc.width AS daily_width, dc.height AS daily_height, dc.target_completion_ms AS daily_target_completion_ms,
       dc.expected_participant_count AS daily_expected_participant_count,
       dc.required_pixel_count AS daily_required_pixel_count,
       dc.pixel_allowance_interval_ms AS daily_pixel_allowance_interval_ms,
       dc.pixel_allowance_max_storage_ms AS daily_pixel_allowance_max_storage_ms, dc.opened_at AS daily_opened_at,
       c.id AS canvas_id_text, c.slug AS canvas_slug, c.width AS canvas_width, c.height AS canvas_height, c.kind AS canvas_kind
     FROM rooms r
     JOIN daily_canvases dc ON dc.room_id = r.id
     JOIN canvases c ON c.id = dc.canvas_id
     WHERE ${whereClause}
       AND dc.canvas_date = (now() AT TIME ZONE r.timezone)::date
       AND ($2::boolean OR r.archived_at IS NULL)`,
    [value, options.includeArchived === true]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return mapRoomToday(row);
}

async function getRoomByWhere(
  db: DbClient,
  whereClause: 'public_id = $1' | 'id = $1',
  value: string,
): Promise<RoomRecord | null> {
  const result = await db.query<RoomRow>(
    `SELECT id, public_id, name, privacy, owner_actor_key, default_width, default_height,
            default_cooldown_ms, target_completion_ms, expected_participant_count,
            pixel_allowance_interval_ms, pixel_allowance_max_storage_ms, timezone,
            created_at, updated_at, archived_at
     FROM rooms
     WHERE ${whereClause}
       AND archived_at IS NULL`,
    [value],
  );

  return result.rows[0] ? mapRoom(result.rows[0]) : null;
}

async function ensureRoomTodayByWhere(
  db: DbClient,
  whereClause: 'r.public_id = $1' | 'r.id = $1',
  roomWhereClause: 'public_id = $1' | 'id = $1',
  value: string,
  options: { today?: Date } = {},
): Promise<{
  room: RoomRecord;
  dailyCanvas: DailyCanvasRecord;
  canvas: CanvasRecord;
} | null> {
  const existing = await getRoomTodayByWhere(db, whereClause, value);
  if (existing) {
    return existing;
  }

  const room = await getRoomByWhere(db, roomWhereClause, value);
  if (!room) {
    return null;
  }

  const client = 'connect' in db ? await db.connect() : db;
  const shouldRelease = 'connect' in db;

  try {
    await client.query('BEGIN');
    const canvasDate = dateInTimeZone(options.today, room.timezone);
    const { canvas, dailyCanvas } = await createOrGetDailyCanvasForRoom(client as DbClient, room, canvasDate);
    await client.query('COMMIT');
    return { room, dailyCanvas, canvas };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (shouldRelease) {
      (client as unknown as { release: () => void }).release();
    }
  }
}

export async function getRoomToday(db: DbClient, publicId: string): Promise<{
  room: RoomRecord;
  dailyCanvas: DailyCanvasRecord;
  canvas: CanvasRecord;
} | null> {
  return getRoomTodayByWhere(db, 'r.public_id = $1', publicId);
}

export async function ensureRoomToday(
  db: DbClient,
  publicId: string,
  options: { today?: Date } = {},
): Promise<{
  room: RoomRecord;
  dailyCanvas: DailyCanvasRecord;
  canvas: CanvasRecord;
} | null> {
  return ensureRoomTodayByWhere(db, 'r.public_id = $1', 'public_id = $1', publicId, options);
}

export async function getRoomTodayById(db: DbClient, roomId: string): Promise<{
  room: RoomRecord;
  dailyCanvas: DailyCanvasRecord;
  canvas: CanvasRecord;
} | null> {
  return getRoomTodayByWhere(db, 'r.id = $1', roomId);
}

export async function ensureRoomTodayById(
  db: DbClient,
  roomId: string,
  options: { today?: Date } = {},
): Promise<{
  room: RoomRecord;
  dailyCanvas: DailyCanvasRecord;
  canvas: CanvasRecord;
} | null> {
  return ensureRoomTodayByWhere(db, 'r.id = $1', 'id = $1', roomId, options);
}

export async function getRoomTodayIncludingArchived(db: DbClient, publicId: string): Promise<{
  room: RoomRecord;
  dailyCanvas: DailyCanvasRecord;
  canvas: CanvasRecord;
} | null> {
  return getRoomTodayByWhere(db, 'r.public_id = $1', publicId, { includeArchived: true });
}

export async function createInvite(db: DbClient, input: CreateInviteInput): Promise<CreatedInvite> {
  return insertInviteWithGeneratedCredentials(db, input);
}

export async function validateInvite(db: DbClient, rawToken: string, inviteSecret: string): Promise<InviteRecord | null> {
  const candidateHash = hashInviteToken(rawToken, inviteSecret);
  const result = await db.query<InviteRow & { code_hash: string }>(
    `SELECT id, room_id, code_hash, created_by_member_id, role_on_join, max_uses, use_count,
            expires_at, revoked_at, created_at
     FROM room_invites
     WHERE code_hash = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR use_count < max_uses)`,
    [candidateHash]
  );
  const invite = result.rows[0];
  if (!invite || !verifyInviteToken(rawToken, invite.code_hash, inviteSecret)) {
    return null;
  }
  return mapInvite(invite);
}

export async function validateInviteByCode(db: DbClient, rawCode: string, inviteSecret: string): Promise<InviteRecord | null> {
  const normalizedCode = normalizeInviteCode(rawCode);
  if (!normalizedCode) {
    return null;
  }

  const candidateHash = hashInviteToken(normalizedCode, inviteSecret);
  const result = await db.query<InviteRow & { short_code_hash: string }>(
    `SELECT id, room_id, short_code_hash, created_by_member_id, role_on_join, max_uses, use_count,
            expires_at, revoked_at, created_at
     FROM room_invites
     WHERE short_code_hash = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR use_count < max_uses)`,
    [candidateHash]
  );
  const invite = result.rows[0];
  if (!invite || !verifyInviteToken(normalizedCode, invite.short_code_hash, inviteSecret)) {
    return null;
  }
  return mapInvite(invite);
}

export async function revokeInvite(db: DbClient, inviteId: string, actorKey: string): Promise<InviteRecord | null> {
  const result = await db.query<InviteRow>(
    `UPDATE room_invites
     SET revoked_at = COALESCE(revoked_at, now()),
         revoked_by_actor_key = COALESCE(revoked_by_actor_key, $2)
     WHERE id = $1
     RETURNING id, room_id, created_by_member_id, role_on_join, max_uses, use_count,
               expires_at, revoked_at, created_at`,
    [inviteId, actorKey]
  );
  return result.rows[0] ? mapInvite(result.rows[0]) : null;
}

export async function ensureRoomMember(db: DbClient, input: EnsureRoomMemberInput): Promise<RoomMemberRecord> {
  const result = await db.query<MemberRow>(
    `INSERT INTO room_members (room_id, actor_key, display_name, role, state, joined_via_invite_id, last_seen_at)
     VALUES ($1, $2, $3, $4, 'active', $5, now())
     ON CONFLICT (room_id, actor_key)
     DO UPDATE SET role = EXCLUDED.role,
                   display_name = COALESCE(room_members.display_name, EXCLUDED.display_name),
                   state = 'active',
                   joined_via_invite_id = COALESCE(room_members.joined_via_invite_id, EXCLUDED.joined_via_invite_id),
                   last_seen_at = now()
     RETURNING id, room_id, actor_key, display_name, display_color, role, state,
               joined_via_invite_id, joined_at, last_seen_at`,
    [input.roomId, input.actorKey, input.displayName ?? null, input.role, input.inviteId ?? null]
  );
  return mapMember(result.rows[0]!);
}

export async function getRecentInviteMemberByIpHash(
  db: DbClient,
  inviteId: string,
  actorIpHash: string,
): Promise<RoomMemberRecord | null> {
  const result = await db.query<MemberRow>(
    `SELECT rm.id, rm.room_id, rm.actor_key, rm.display_name, rm.display_color, rm.role, rm.state,
            rm.joined_via_invite_id, rm.joined_at, rm.last_seen_at
     FROM room_invite_uses riu
     JOIN room_members rm
       ON rm.room_id = riu.room_id
      AND rm.actor_key = riu.actor_key
      AND rm.state = 'active'
     WHERE riu.invite_id = $1
       AND riu.actor_ip_hash = $2
       AND rm.display_name IS NOT NULL
       AND char_length(trim(rm.display_name)) > 0
     ORDER BY riu.used_at DESC
     LIMIT 1`,
    [inviteId, actorIpHash],
  );

  return result.rows[0] ? mapMember(result.rows[0]) : null;
}

export async function consumeInviteUse(db: DbClient, input: ConsumeInviteUseInput): Promise<InviteRecord | null> {
  const client = 'connect' in db ? await db.connect() : db;
  const shouldRelease = 'connect' in db;
  const candidateHash = hashInviteToken(input.rawToken, input.inviteSecret);

  try {
    await client.query('BEGIN');
    const updateResult = await client.query<InviteRow & { code_hash: string }>(
      `UPDATE room_invites
       SET use_count = use_count + 1
       WHERE code_hash = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
         AND (max_uses IS NULL OR use_count < max_uses)
       RETURNING id, room_id, code_hash, created_by_member_id, role_on_join, max_uses, use_count,
                 expires_at, revoked_at, created_at`,
      [candidateHash]
    );
    const invite = updateResult.rows[0];
    if (!invite || !verifyInviteToken(input.rawToken, invite.code_hash, input.inviteSecret)) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      `INSERT INTO room_invite_uses (invite_id, room_id, actor_key, actor_ip_hash)
       VALUES ($1, $2, $3, $4)`,
      [invite.id, invite.room_id, input.actorKey, input.actorIpHash ?? null]
    );

    await client.query('COMMIT');
    return mapInvite(invite);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (shouldRelease) {
      (client as unknown as { release: () => void }).release();
    }
  }
}

export async function getActiveRoomMember(
  db: DbClient,
  roomId: string,
  actorKey: string
): Promise<RoomMemberRecord | null> {
  const result = await db.query<MemberRow>(
    `SELECT id, room_id, actor_key, display_name, display_color, role, state,
            joined_via_invite_id, joined_at, last_seen_at
     FROM room_members
     WHERE room_id = $1
       AND actor_key = $2
       AND state = 'active'`,
    [roomId, actorKey]
  );
  return result.rows[0] ? mapMember(result.rows[0]) : null;
}

export async function updateRoomMemberDisplayName(
  db: DbClient,
  roomId: string,
  actorKey: string,
  displayName: string | null
): Promise<RoomMemberRecord | null> {
  const result = await db.query<MemberRow>(
    `UPDATE room_members
     SET display_name = $3,
         last_seen_at = now()
     WHERE room_id = $1
       AND actor_key = $2
       AND state = 'active'
     RETURNING id, room_id, actor_key, display_name, display_color, role, state,
               joined_via_invite_id, joined_at, last_seen_at`,
    [roomId, actorKey, displayName]
  );
  return result.rows[0] ? mapMember(result.rows[0]) : null;
}

export async function appendAnalyticsEvent(db: DbClient, event: AnalyticsEventInput): Promise<void> {
  await db.query(
    `INSERT INTO analytics_events (name, room_id, room_public_id, actor_key, properties, occurred_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, now()))`,
    [
      event.name,
      event.roomId ?? null,
      event.roomPublicId ?? null,
      event.actorKey ?? null,
      JSON.stringify(event.properties ?? {}),
      event.occurredAt ?? null
    ]
  );
}
