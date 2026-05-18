import { DEFAULT_PALETTE } from '@pixel-world/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createBlock, getRecentEvents, upsertPixelAndLog } from '../src/db/canvasRepository';
import { createDbPool, type DbPool } from '../src/db/index';
import { runMigrations } from '../src/db/migrate';
import { InMemoryPixelAllowanceStore, checkAndConsumePixelAllowance } from '../src/services/pixelAllowanceService';
import {
  createRoomWithTodayCanvas,
  getActiveRoomMember,
  type CreatedRoomWithTodayCanvas,
} from '../src/rooms/roomRepository';
import { placeQuickPixel, QuickPixelRejectedError } from '../src/rooms/quickPixelService';

const TEST_PREFIX = `quick-pixel-test-${process.pid}`;
const INVITE_SECRET = 'quick-pixel-test-invite-secret';
const ACTOR_IP_HASH = 'f'.repeat(64);

let pool: DbPool;
let roomCounter = 0;

async function dbTodayAtNoonUtc(): Promise<Date> {
  const result = await pool.query<{ today: string }>("SELECT ((now() AT TIME ZONE 'UTC')::date)::text AS today");
  return new Date(`${result.rows[0]!.today}T12:00:00.000Z`);
}

async function cleanupQuickPixelTestData(): Promise<void> {
  await pool.query(
    `DELETE FROM analytics_events
     WHERE room_public_id LIKE $1
        OR properties::text LIKE $2`,
    [`${TEST_PREFIX}%`, `%${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM pixel_events
     WHERE canvas_id IN (
       SELECT dc.canvas_id
       FROM daily_canvases dc
       JOIN rooms r ON r.id = dc.room_id
       WHERE r.public_id LIKE $1 OR r.name LIKE $2
     )`,
    [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM pixels
     WHERE canvas_id IN (
       SELECT dc.canvas_id
       FROM daily_canvases dc
       JOIN rooms r ON r.id = dc.room_id
       WHERE r.public_id LIKE $1 OR r.name LIKE $2
     )`,
    [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM blocks
     WHERE actor_key LIKE $1
        OR room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR name LIKE $2)`,
    [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM room_invite_uses
     WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR name LIKE $2)`,
    [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM room_invites
     WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR name LIKE $2)`,
    [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM room_members
     WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR name LIKE $2)`,
    [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM daily_canvases
     WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR name LIKE $2)`,
    [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`],
  );
  await pool.query('DELETE FROM canvases WHERE id LIKE $1 OR slug LIKE $1', [`room_${TEST_PREFIX}%`]);
  await pool.query('DELETE FROM rooms WHERE public_id LIKE $1 OR name LIKE $2', [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`]);
}

async function createTestRoom(overrides: Partial<Parameters<typeof createRoomWithTodayCanvas>[1]> = {}): Promise<CreatedRoomWithTodayCanvas> {
  roomCounter += 1;
  return createRoomWithTodayCanvas(pool, {
    name: `${TEST_PREFIX} room ${roomCounter}`,
    ownerActorKey: `${TEST_PREFIX}-owner-${roomCounter}`,
    inviteSecret: INVITE_SECRET,
    publicIdPrefix: `${TEST_PREFIX}-${roomCounter}`,
    today: overrides.today ?? await dbTodayAtNoonUtc(),
    timezone: 'UTC',
    expectedParticipantCount: 4,
    targetCompletionMs: 60 * 60 * 1000,
    pixelAllowanceMaxStorageMs: 60 * 60 * 1000,
    ...overrides,
  });
}

async function quickPixel(room: CreatedRoomWithTodayCanvas, actorKey: string, options: Partial<Parameters<typeof placeQuickPixel>[0]> = {}) {
  return placeQuickPixel({
    db: pool,
    allowanceStore: new InMemoryPixelAllowanceStore(),
    inviteSecret: INVITE_SECRET,
    roomPublicId: room.room.publicId,
    actorKey,
    actorIpHash: ACTOR_IP_HASH,
    inviteToken: room.invite.rawToken,
    displayName: '초대 손님',
    nowMs: Date.now(),
    ...options,
  });
}

beforeAll(async () => {
  await runMigrations();
  pool = createDbPool(loadConfig());
});

beforeEach(async () => {
  await cleanupQuickPixelTestData();
});

afterAll(async () => {
  await cleanupQuickPixelTestData();
  await pool.end();
});

describe('placeQuickPixel', () => {
  it('places first invited Quick Pixel with the required nickname', async () => {
    const room = await createTestRoom();

    const result = await quickPixel(room, `${TEST_PREFIX}-guest-first`, {
      suggestedCoordinate: { x: 3, y: 4 },
      suggestedColorHex: '#38bdf8',
    });

    expect(result).toMatchObject({
      accepted: true,
      roomPublicId: room.room.publicId,
      dailyCanvasId: room.dailyCanvas.id,
      canvasId: room.canvas.id,
      x: 3,
      y: 4,
      colorHex: '#38BDF8',
      optionalNamePrompt: false,
      savedPixelCount: 0,
    });
    expect(result.nextPixelSavedAt).toEqual(expect.any(String));
    expect(result.maxStorageEndsAt).toEqual(expect.any(String));

    const saved = await pool.query(
      `SELECT p.color_hex, rm.display_name, rm.role
       FROM pixels p
       JOIN room_members rm ON rm.room_id = $1 AND rm.actor_key = $2
       WHERE p.canvas_id = $3 AND p.x = 3 AND p.y = 4`,
      [room.room.id, `${TEST_PREFIX}-guest-first`, room.canvas.id],
    );
    expect(saved.rows[0]).toEqual({ color_hex: '#38BDF8', display_name: '초대 손님', role: 'guest' });
  });

  it('rejects a first invited Quick Pixel without nickname when there is no same-IP match', async () => {
    const room = await createTestRoom();

    await expect(quickPixel(room, `${TEST_PREFIX}-guest-no-name`, { displayName: undefined })).rejects.toMatchObject({
      code: 'display_name_required',
    });

    await expect(getActiveRoomMember(pool, room.room.id, `${TEST_PREFIX}-guest-no-name`)).resolves.toBeNull();
  });

  it('does not reuse a previous nickname for a different actor on the same invite and IP', async () => {
    const room = await createTestRoom();
    const ipHash = 'a'.repeat(64);

    await quickPixel(room, `${TEST_PREFIX}-guest-named`, {
      actorIpHash: ipHash,
      displayName: '준호',
      suggestedCoordinate: { x: 1, y: 1 },
    });

    await expect(quickPixel(room, `${TEST_PREFIX}-guest-reused-ip`, {
      actorIpHash: ipHash,
      displayName: undefined,
      suggestedCoordinate: { x: 2, y: 1 },
    })).rejects.toMatchObject({ code: 'display_name_required' });

    await expect(getActiveRoomMember(pool, room.room.id, `${TEST_PREFIX}-guest-reused-ip`)).resolves.toBeNull();
  });

  it('creates guest membership when invite is valid', async () => {
    const room = await createTestRoom();
    const actorKey = `${TEST_PREFIX}-guest-member`;

    await quickPixel(room, actorKey);

    const member = await getActiveRoomMember(pool, room.room.id, actorKey);
    expect(member).toEqual(
      expect.objectContaining({
        roomId: room.room.id,
        actorKey,
        role: 'guest',
        joinedViaInviteId: room.invite.id,
        displayName: '초대 손님',
      }),
    );
  });

  it('chooses a safe fallback coordinate when the suggestion is unavailable', async () => {
    const room = await createTestRoom();
    await upsertPixelAndLog(pool, {
      canvasId: room.canvas.id,
      x: 0,
      y: 0,
      colorHex: '#EF4444',
      actorKey: `${TEST_PREFIX}-existing-pixel`,
      actorIpHash: ACTOR_IP_HASH,
      source: 'user',
    });

    const result = await quickPixel(room, `${TEST_PREFIX}-guest-fallback`, {
      suggestedCoordinate: { x: 0, y: 0 },
    });

    expect(result).toMatchObject({ accepted: true });
    expect({ x: result.x, y: result.y }).not.toEqual({ x: 0, y: 0 });

    const occupied = await pool.query('SELECT color_hex FROM pixels WHERE canvas_id = $1 AND x = $2 AND y = $3', [
      room.canvas.id,
      result.x,
      result.y,
    ]);
    expect(occupied.rows[0]!.color_hex).toBe(result.colorHex);
  });


  it('concurrent same-coordinate Quick Pixels reserve distinct empty pixels without overwriting', async () => {
    const room = await createTestRoom();
    const store = new InMemoryPixelAllowanceStore();
    const actors = Array.from({ length: 6 }, (_, index) => `${TEST_PREFIX}-concurrent-${index}`);

    const results = await Promise.all(
      actors.map((actorKey) =>
        quickPixel(room, actorKey, {
          allowanceStore: store,
          suggestedCoordinate: { x: 7, y: 7 },
        }),
      ),
    );

    const coordinates = new Set(results.map((result) => `${result.x},${result.y}`));
    expect(coordinates.size).toBe(results.length);

    const pixels = await pool.query<{ count: string }>('SELECT count(*) FROM pixels WHERE canvas_id = $1', [room.canvas.id]);
    expect(Number(pixels.rows[0]!.count)).toBe(results.length);

    const events = await getRecentEvents(pool, room.canvas.id, 20);
    const quickPixelEvents = events.filter((event) => actors.includes(event.actorKey));
    expect(quickPixelEvents).toHaveLength(results.length);
    expect(quickPixelEvents.every((event) => event.previousColorHex === null)).toBe(true);
  });

  it('does not consume invite or create membership when color is invalid', async () => {
    const room = await createTestRoom();
    const actorKey = `${TEST_PREFIX}-invalid-color-new-actor`;

    await expect(quickPixel(room, actorKey, { suggestedColorHex: 'not-a-color' })).rejects.toMatchObject({
      code: 'invalid_color',
    });

    const invite = await pool.query<{ use_count: number }>('SELECT use_count FROM room_invites WHERE id = $1', [room.invite.id]);
    expect(Number(invite.rows[0]!.use_count)).toBe(0);
    await expect(getActiveRoomMember(pool, room.room.id, actorKey)).resolves.toBeNull();
  });

  it('does not consume invite or create membership when canvas is already full', async () => {
    const room = await createTestRoom();
    const actorKey = `${TEST_PREFIX}-full-canvas-new-actor`;
    const inserts: Promise<unknown>[] = [];
    for (let y = 0; y < room.canvas.height; y += 1) {
      for (let x = 0; x < room.canvas.width; x += 1) {
        inserts.push(
          upsertPixelAndLog(pool, {
            canvasId: room.canvas.id,
            x,
            y,
            colorHex: DEFAULT_PALETTE[(x + y) % DEFAULT_PALETTE.length]!,
            actorKey: `${TEST_PREFIX}-pre-fill-${x}-${y}`,
            actorIpHash: ACTOR_IP_HASH,
            source: 'user',
          }),
        );
      }
    }
    await Promise.all(inserts);

    await expect(quickPixel(room, actorKey)).rejects.toMatchObject({ code: 'canvas_full' });

    const invite = await pool.query<{ use_count: number }>('SELECT use_count FROM room_invites WHERE id = $1', [room.invite.id]);
    expect(Number(invite.rows[0]!.use_count)).toBe(0);
    await expect(getActiveRoomMember(pool, room.room.id, actorKey)).resolves.toBeNull();
  });

  it('rejects placement when room is archived', async () => {
    const room = await createTestRoom();
    await pool.query('UPDATE rooms SET archived_at = now() WHERE id = $1', [room.room.id]);

    await expect(quickPixel(room, `${TEST_PREFIX}-guest-archived`)).rejects.toMatchObject({
      code: 'room_archived',
      friendlyMessage: 'This room is no longer accepting Quick Pixels.',
    });
  });


  it.each([
    ['global', (room: CreatedRoomWithTodayCanvas) => ({ scopeType: 'global' as const })],
    ['room', (room: CreatedRoomWithTodayCanvas) => ({ scopeType: 'room' as const, roomId: room.room.id })],
    ['canvas', (room: CreatedRoomWithTodayCanvas) => ({
      scopeType: 'canvas' as const,
      roomId: room.room.id,
      dailyCanvasId: room.dailyCanvas.id,
      canvasId: room.canvas.id,
    })],
  ])('rejects %s-scoped blocked actors before Quick Pixel side effects', async (_scopeName, scopeForRoom) => {
    const room = await createTestRoom();
    const actorKey = `${TEST_PREFIX}-blocked-${_scopeName}`;
    const store = new InMemoryPixelAllowanceStore();
    await createBlock(pool, {
      actorKey,
      reason: `${TEST_PREFIX} ${_scopeName} quick pixel block`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      ...scopeForRoom(room),
    });

    await expect(quickPixel(room, actorKey, { allowanceStore: store })).rejects.toMatchObject({
      code: 'blocked',
      statusCode: 403,
    });

    const invite = await pool.query<{ use_count: number }>('SELECT use_count FROM room_invites WHERE id = $1', [room.invite.id]);
    expect(Number(invite.rows[0]!.use_count)).toBe(0);
    await expect(getActiveRoomMember(pool, room.room.id, actorKey)).resolves.toBeNull();
    const pixels = await pool.query<{ count: string }>('SELECT count(*) FROM pixels WHERE canvas_id = $1', [room.canvas.id]);
    expect(Number(pixels.rows[0]!.count)).toBe(0);

    const allowance = await checkAndConsumePixelAllowance(
      store,
      `canvas:${room.canvas.id}`,
      actorKey,
      Date.now(),
      {
        dynamicAllowanceIntervalMs: room.dailyCanvas.pixelAllowanceIntervalMs,
        pixelAllowanceMaxStorageMs: room.dailyCanvas.pixelAllowanceMaxStorageMs,
        maxSavedPixelCount: room.dailyCanvas.requiredPixelCount,
      },
    );
    expect(allowance.allowed).toBe(true);
    expect(allowance.savedPixelCount).toBe(0);
  });

  it('spends allowance scoped to room and actor', async () => {
    const firstRoom = await createTestRoom();
    const secondRoom = await createTestRoom();
    const store = new InMemoryPixelAllowanceStore();
    const actorKey = `${TEST_PREFIX}-scoped-actor`;

    const first = await quickPixel(firstRoom, actorKey, { allowanceStore: store });
    const blockedSameRoom = () => placeQuickPixel({
      db: pool,
      allowanceStore: store,
      inviteSecret: INVITE_SECRET,
      roomPublicId: firstRoom.room.publicId,
      actorKey,
      actorIpHash: ACTOR_IP_HASH,
      inviteToken: firstRoom.invite.rawToken,
      nowMs: Date.now() + 1,
    });
    const otherRoom = await quickPixel(secondRoom, actorKey, { allowanceStore: store });

    expect(first.savedPixelCount).toBe(0);
    await expect(blockedSameRoom()).rejects.toMatchObject({ code: 'allowance_empty' });
    expect(otherRoom.accepted).toBe(true);

    const globalAllowance = await checkAndConsumePixelAllowance(
      store,
      'global',
      actorKey,
      Date.now() + 1,
      {
        dynamicAllowanceIntervalMs: firstRoom.dailyCanvas.pixelAllowanceIntervalMs,
        pixelAllowanceMaxStorageMs: firstRoom.dailyCanvas.pixelAllowanceMaxStorageMs,
        maxSavedPixelCount: firstRoom.dailyCanvas.requiredPixelCount,
      },
    );
    expect(globalAllowance.allowed).toBe(true);
  });

  it('lets temporary unlimited placement mode skip Quick Pixel allowance spending', async () => {
    const room = await createTestRoom();
    const store = new InMemoryPixelAllowanceStore();
    const actorKey = `${TEST_PREFIX}-unlimited-quick-pixel`;

    const first = await quickPixel(room, actorKey, {
      allowanceStore: store,
      suggestedCoordinate: { x: 1, y: 1 },
      unlimitedPixelPlacement: true,
    });
    const second = await quickPixel(room, actorKey, {
      allowanceStore: store,
      suggestedCoordinate: { x: 2, y: 1 },
      unlimitedPixelPlacement: true,
    });

    expect(first.savedPixelCount).toBe(first.maxSavedPixelCount);
    expect(second.accepted).toBe(true);
    expect(second.savedPixelCount).toBe(second.maxSavedPixelCount);
  });


  it('resets room allowance for the same actor on a different daily canvas', async () => {
    const room = await createTestRoom();
    const store = new InMemoryPixelAllowanceStore();
    const actorKey = `${TEST_PREFIX}-same-room-next-day`;

    const first = await quickPixel(room, actorKey, {
      allowanceStore: store,
      suggestedCoordinate: { x: 5, y: 5 },
    });

    await pool.query(
      `UPDATE daily_canvases
       SET canvas_date = ((now() AT TIME ZONE 'UTC')::date - INTERVAL '1 day')::date
       WHERE id = $1`,
      [room.dailyCanvas.id],
    );
    const nextCanvasId = `${room.canvas.id}_next_day`;
    await pool.query(
      `INSERT INTO canvases (id, slug, width, height, kind)
       VALUES ($1, $1, $2, $3, 'room_daily')`,
      [nextCanvasId, room.canvas.width, room.canvas.height],
    );
    const nextDailyCanvas = await pool.query<{ id: string }>(
      `INSERT INTO daily_canvases
       (room_id, canvas_date, canvas_id, status, width, height, cooldown_ms, target_completion_ms,
        expected_participant_count, required_pixel_count, pixel_allowance_interval_ms,
        pixel_allowance_max_storage_ms, opened_at)
       VALUES ($1, (now() AT TIME ZONE 'UTC')::date, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10, now())
       RETURNING id`,
      [
        room.room.id,
        nextCanvasId,
        room.canvas.width,
        room.canvas.height,
        room.room.defaultCooldownMs,
        room.dailyCanvas.targetCompletionMs,
        room.dailyCanvas.expectedParticipantCount,
        room.dailyCanvas.requiredPixelCount,
        room.dailyCanvas.pixelAllowanceIntervalMs,
        room.dailyCanvas.pixelAllowanceMaxStorageMs,
      ],
    );

    const second = await quickPixel(room, actorKey, {
      allowanceStore: store,
      inviteToken: undefined,
      nowMs: Date.now() + 1,
      suggestedCoordinate: { x: 6, y: 6 },
    });

    expect(first.savedPixelCount).toBe(0);
    expect(second).toMatchObject({
      accepted: true,
      dailyCanvasId: nextDailyCanvas.rows[0]!.id,
      canvasId: nextCanvasId,
      savedPixelCount: 0,
    });
  });

  it('does not remove already saved actions when participant count changes', async () => {
    const room = await createTestRoom({
      expectedParticipantCount: 1,
      targetCompletionMs: 1024 * 1000,
      pixelAllowanceMaxStorageMs: 1024 * 1000,
    });
    const store = new InMemoryPixelAllowanceStore();
    const actorKey = `${TEST_PREFIX}-participant-change`;

    const first = await quickPixel(room, actorKey, {
      allowanceStore: store,
      nowMs: 0,
      suggestedCoordinate: { x: 1, y: 1 },
    });
    await pool.query(
      `UPDATE daily_canvases
       SET expected_participant_count = 8,
           pixel_allowance_interval_ms = pixel_allowance_interval_ms / 8
       WHERE id = $1`,
      [room.dailyCanvas.id],
    );
    const second = await quickPixel(room, actorKey, {
      allowanceStore: store,
      nowMs: 1024 * 1000,
      suggestedCoordinate: { x: 2, y: 2 },
    });

    expect(first.savedPixelCount).toBe(0);
    expect(second.accepted).toBe(true);
    expect(second.savedPixelCount).toBeGreaterThan(0);
  });

  it('returns a friendly full-canvas rejection when no coordinate is available', async () => {
    const room = await createTestRoom();
    const inserts: Promise<unknown>[] = [];
    for (let y = 0; y < room.canvas.height; y += 1) {
      for (let x = 0; x < room.canvas.width; x += 1) {
        inserts.push(
          upsertPixelAndLog(pool, {
            canvasId: room.canvas.id,
            x,
            y,
            colorHex: DEFAULT_PALETTE[(x + y) % DEFAULT_PALETTE.length]!,
            actorKey: `${TEST_PREFIX}-fill-${x}-${y}`,
            actorIpHash: ACTOR_IP_HASH,
            source: 'user',
          }),
        );
      }
    }
    await Promise.all(inserts);

    await expect(quickPixel(room, `${TEST_PREFIX}-guest-full`)).rejects.toEqual(
      new QuickPixelRejectedError('canvas_full', 'This canvas is full. Try tomorrow’s room canvas.'),
    );
  });
});
