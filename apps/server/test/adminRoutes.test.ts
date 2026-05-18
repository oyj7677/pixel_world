import { DEFAULT_CANVAS_ID } from '@pixel-world/shared';
import { createRoomWithTodayCanvas } from '../src/rooms/roomRepository';
import { upsertPixelAndLog } from '../src/db/canvasRepository';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import {
  ADMIN_COOKIE,
  createAdminSessionToken,
  isCorrectAdminPassword,
  verifyAdminSessionToken
} from '../src/auth/adminSession';
import { loadConfig, type ServerConfig } from '../src/config';
import { createDbPool, type DbPool } from '../src/db/index';
import { runMigrations } from '../src/db/migrate';
import type { PixelSocketServer } from '../src/realtime/socketServer';

const TEST_COORDINATES = [
  [17, 18],
  [19, 20],
  [20, 20],
  [19, 21],
  [20, 21]
] as const;
const TEST_ACTOR_KEY = 'act_0123456789abcdef0123456789abcdef';
const TEST_ACTOR_IP_HASH = 'a'.repeat(64);
const INVALID_BLOCK_REASON = 'admin route invalid block';
const TEST_ROOM_PREFIX = `admin-room-scope-${process.pid}`;
const TEST_ROOM_ACTOR_A = 'act_adminroomscope000000000000000001';
const TEST_ROOM_ACTOR_B = 'act_adminroomscope000000000000000002';

let pool: DbPool;
let config: ServerConfig;
let app: Awaited<ReturnType<typeof buildApp>> | null = null;

function testConfig(): ServerConfig {
  return {
    ...config,
    adminPassword: 'admin-routes-test-password',
    cookieSecret: 'admin-routes-test-cookie-secret'
  };
}

async function startApp() {
  app = await buildApp(testConfig());
  await app.ready();
  return app;
}

async function cleanupAdminRouteTestData(): Promise<void> {
  await pool.query(
    `DELETE FROM pixel_events
     WHERE canvas_id IN (
       SELECT dc.canvas_id
       FROM daily_canvases dc
       JOIN rooms r ON r.id = dc.room_id
       WHERE r.public_id LIKE $1 OR r.owner_actor_key IN ($2, $3)
     )`,
    [`${TEST_ROOM_PREFIX}%`, TEST_ROOM_ACTOR_A, TEST_ROOM_ACTOR_B]
  );
  await pool.query(
    `DELETE FROM pixels
     WHERE canvas_id IN (
       SELECT dc.canvas_id
       FROM daily_canvases dc
       JOIN rooms r ON r.id = dc.room_id
       WHERE r.public_id LIKE $1 OR r.owner_actor_key IN ($2, $3)
     )`,
    [`${TEST_ROOM_PREFIX}%`, TEST_ROOM_ACTOR_A, TEST_ROOM_ACTOR_B]
  );
  await pool.query(
    `DELETE FROM admin_actions
     WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key IN ($2, $3))
        OR metadata->>'reason' IN ('room scoped reset', 'room audit reset', 'canvas scoped block')`,
    [`${TEST_ROOM_PREFIX}%`, TEST_ROOM_ACTOR_A, TEST_ROOM_ACTOR_B]
  );
  await pool.query(
    `DELETE FROM blocks
     WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key IN ($2, $3))`,
    [`${TEST_ROOM_PREFIX}%`, TEST_ROOM_ACTOR_A, TEST_ROOM_ACTOR_B]
  );
  await pool.query(
    `DELETE FROM room_invite_uses WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key IN ($2, $3))`,
    [`${TEST_ROOM_PREFIX}%`, TEST_ROOM_ACTOR_A, TEST_ROOM_ACTOR_B]
  );
  await pool.query(
    `DELETE FROM room_pixel_allowances WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key IN ($2, $3))`,
    [`${TEST_ROOM_PREFIX}%`, TEST_ROOM_ACTOR_A, TEST_ROOM_ACTOR_B]
  );
  await pool.query(
    `DELETE FROM room_invites WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key IN ($2, $3))`,
    [`${TEST_ROOM_PREFIX}%`, TEST_ROOM_ACTOR_A, TEST_ROOM_ACTOR_B]
  );
  await pool.query(
    `DELETE FROM room_members WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key IN ($2, $3))`,
    [`${TEST_ROOM_PREFIX}%`, TEST_ROOM_ACTOR_A, TEST_ROOM_ACTOR_B]
  );
  await pool.query(
    `DELETE FROM daily_canvases WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key IN ($2, $3))`,
    [`${TEST_ROOM_PREFIX}%`, TEST_ROOM_ACTOR_A, TEST_ROOM_ACTOR_B]
  );
  await pool.query('DELETE FROM canvases WHERE id LIKE $1 OR slug LIKE $1', [`room_${TEST_ROOM_PREFIX}%`]);
  await pool.query(
    `DELETE FROM rooms WHERE public_id LIKE $1 OR owner_actor_key IN ($2, $3)`,
    [`${TEST_ROOM_PREFIX}%`, TEST_ROOM_ACTOR_A, TEST_ROOM_ACTOR_B]
  );

  for (const [x, y] of TEST_COORDINATES) {
    await pool.query('DELETE FROM pixel_events WHERE canvas_id = $1 AND x = $2 AND y = $3', [
      DEFAULT_CANVAS_ID,
      x,
      y
    ]);
    await pool.query('DELETE FROM pixels WHERE canvas_id = $1 AND x = $2 AND y = $3', [
      DEFAULT_CANVAS_ID,
      x,
      y
    ]);
  }

  await pool.query(
    `DELETE FROM admin_actions
     WHERE target_summary IN ('17,18', '19,20-20,21', $1, $2)
        OR metadata->>'reason' = $3
        OR (action_type = 'restore_pixel' AND target_summary = '17,18')
        OR (action_type = 'restore_area' AND target_summary = '19,20-20,21')`,
    [TEST_ACTOR_KEY, TEST_ACTOR_IP_HASH, INVALID_BLOCK_REASON]
  );
  await pool.query(
    `DELETE FROM blocks
     WHERE actor_key = $1
        OR actor_ip_hash = $2
        OR reason IN ('admin route test block', 'uppercase ip-only block', 'canvas scoped block', $3)`,
    [TEST_ACTOR_KEY, TEST_ACTOR_IP_HASH, INVALID_BLOCK_REASON]
  );
}

function getAdminCookie(setCookie: string[] | undefined): string {
  const cookie = setCookie?.find((value) => value.startsWith(`${ADMIN_COOKIE}=`));
  expect(cookie).toBeDefined();
  return cookie!.split(';')[0]!;
}

async function loginAdminCookie(): Promise<string> {
  const login = await app!.inject({
    method: 'POST',
    url: '/admin/login',
    payload: { password: testConfig().adminPassword }
  });
  const setCookie = login.headers['set-cookie'];
  return getAdminCookie(Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : undefined);
}

async function countInvalidBlockMutations(reason = INVALID_BLOCK_REASON): Promise<number> {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::int
        FROM blocks
        WHERE actor_key = $1 OR actor_ip_hash = $2 OR reason = $3) AS block_count,
       (SELECT count(*)::int
        FROM admin_actions
        WHERE action_type = 'block_actor'
          AND (target_summary IN ($1, $2) OR metadata->>'reason' = $3)) AS action_count`,
    [TEST_ACTOR_KEY, TEST_ACTOR_IP_HASH, reason]
  );

  return Number(result.rows[0].block_count) + Number(result.rows[0].action_count);
}

beforeAll(async () => {
  await runMigrations();
  config = loadConfig();
  pool = createDbPool(config);
});

beforeEach(async () => {
  await cleanupAdminRouteTestData();
  await startApp();
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  await cleanupAdminRouteTestData();
});

afterAll(async () => {
  await pool.end();
});

describe('admin session token helpers', () => {
  it('creates verifiable HMAC tokens and rejects tampered, expired, and future-issued tokens', () => {
    const secret = 'admin-session-secret';
    const token = createAdminSessionToken(secret);

    expect(verifyAdminSessionToken(token, secret, 4 * 60 * 60 * 1000)).toBe(true);
    expect(verifyAdminSessionToken(undefined, secret, 4 * 60 * 60 * 1000)).toBe(false);
    expect(verifyAdminSessionToken(`${token}tampered`, secret, 4 * 60 * 60 * 1000)).toBe(false);
    expect(verifyAdminSessionToken(token, 'different-secret', 4 * 60 * 60 * 1000)).toBe(false);

    const [issuedAt, signature] = token.split('.');
    const expiredIssuedAt = Number(issuedAt) - 5 * 60 * 60 * 1000;
    expect(verifyAdminSessionToken(`${expiredIssuedAt}.${signature}`, secret, 4 * 60 * 60 * 1000)).toBe(false);

    const now = Date.now();
    try {
      vi.setSystemTime(now + 10 * 60 * 1000);
      const futureSignatureToken = createAdminSessionToken(secret);
      vi.setSystemTime(now);
      expect(verifyAdminSessionToken(futureSignatureToken, secret, 4 * 60 * 60 * 1000)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('compares admin passwords through fixed-length digests', () => {
    expect(isCorrectAdminPassword('admin-routes-test-password', 'admin-routes-test-password')).toBe(true);
    expect(isCorrectAdminPassword('admin-routes-test-passwore', 'admin-routes-test-password')).toBe(false);
    expect(isCorrectAdminPassword('wrong', 'admin-routes-test-password')).toBe(false);
    expect(isCorrectAdminPassword('x'.repeat(4097), 'admin-routes-test-password')).toBe(false);
  });
});

describe('admin routes', () => {
  it('requires an admin session for events', async () => {
    const response = await app!.inject({ method: 'GET', url: '/admin/events' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'admin_session_required' });
  });

  it('rejects wrong password login without granting admin access', async () => {
    const login = await app!.inject({
      method: 'POST',
      url: '/admin/login',
      payload: { password: 'wrong-password' }
    });

    expect(login.statusCode).toBe(401);
    expect(login.json()).toEqual({ error: 'invalid_admin_password' });
    expect(login.cookies.some((cookie) => cookie.name === ADMIN_COOKIE)).toBe(false);

    const events = await app!.inject({ method: 'GET', url: '/admin/events' });
    expect(events.statusCode).toBe(401);
  });

  it('sets an httpOnly admin cookie on correct login and allows event access with it', async () => {
    const login = await app!.inject({
      method: 'POST',
      url: '/admin/login',
      payload: { password: testConfig().adminPassword }
    });

    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ ok: true });
    const setCookie = login.headers['set-cookie'];
    const setCookieValues = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : undefined;
    const cookie = getAdminCookie(setCookieValues);
    expect(setCookieValues!.find((value) => value.startsWith(`${ADMIN_COOKIE}=`))).toContain('HttpOnly');

    const events = await app!.inject({
      method: 'GET',
      url: '/admin/events',
      headers: { cookie }
    });

    expect(events.statusCode).toBe(200);
    expect(events.json()).toEqual({ events: expect.any(Array) });
  });

  it('validates restore pixel requests and logs the admin pixel event and action', async () => {
    const cookie = await loginAdminCookie();

    const invalid = await app!.inject({
      method: 'POST',
      url: '/admin/restore/pixel',
      headers: { cookie },
      payload: { x: 17, y: 18, colorHex: 'not-a-color' }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: 'invalid_restore_request' });

    const restored = await app!.inject({
      method: 'POST',
      url: '/admin/restore/pixel',
      headers: { cookie },
      payload: { x: 17, y: 18, colorHex: '#38bdf8' }
    });

    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toEqual({
      event: expect.objectContaining({
        x: 17,
        y: 18,
        newColorHex: '#38BDF8',
        actorKey: 'admin',
        actorIpHash: 'admin',
        source: 'admin'
      })
    });

    const adminAction = await pool.query(
      `SELECT metadata
       FROM admin_actions
       WHERE action_type = 'restore_pixel' AND target_summary = '17,18'
       ORDER BY created_at DESC
       LIMIT 1`
    );
    expect(adminAction.rows[0]?.metadata).toEqual({ colorHex: '#38BDF8' });
  });

  it('restores a small area with a moderation reason and logs the admin action', async () => {
    const cookie = await loginAdminCookie();

    const restored = await app!.inject({
      method: 'POST',
      url: '/admin/restore/area',
      headers: { cookie },
      payload: {
        fromX: 19,
        fromY: 20,
        toX: 20,
        toY: 21,
        colorHex: '#22c55e',
        reason: 'spam cleanup'
      }
    });

    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toEqual({
      events: expect.arrayContaining([
        expect.objectContaining({ x: 19, y: 20, newColorHex: '#22C55E', source: 'admin' }),
        expect.objectContaining({ x: 20, y: 21, newColorHex: '#22C55E', source: 'admin' })
      ])
    });
    expect(restored.json().events).toHaveLength(4);

    const adminAction = await pool.query(
      `SELECT metadata
       FROM admin_actions
       WHERE action_type = 'restore_area' AND target_summary = '19,20-20,21'
       ORDER BY created_at DESC
       LIMIT 1`
    );
    expect(adminAction.rows[0]?.metadata).toEqual({
      colorHex: '#22C55E',
      count: 4,
      reason: 'spam cleanup'
    });
  });


  it('allows room-scoped admin reset without affecting another room', async () => {
    const cookie = await loginAdminCookie();
    const first = await createRoomWithTodayCanvas(pool, {
      name: `${TEST_ROOM_PREFIX} reset first`,
      ownerActorKey: TEST_ROOM_ACTOR_A,
      inviteSecret: testConfig().cookieSecret,
      publicIdPrefix: `${TEST_ROOM_PREFIX}-a`
    });
    const second = await createRoomWithTodayCanvas(pool, {
      name: `${TEST_ROOM_PREFIX} reset second`,
      ownerActorKey: TEST_ROOM_ACTOR_B,
      inviteSecret: testConfig().cookieSecret,
      publicIdPrefix: `${TEST_ROOM_PREFIX}-b`
    });
    await upsertPixelAndLog(pool, { canvasId: first.canvas.id, x: 2, y: 3, colorHex: '#EF4444', actorKey: TEST_ROOM_ACTOR_A, actorIpHash: 'admin-test-a', source: 'user' });
    await upsertPixelAndLog(pool, { canvasId: second.canvas.id, x: 2, y: 3, colorHex: '#22C55E', actorKey: TEST_ROOM_ACTOR_B, actorIpHash: 'admin-test-b', source: 'user' });

    const broadcastPixelUpdated = vi.fn();
    app!.pixelSocketServer = { broadcastPixelUpdated } as unknown as PixelSocketServer;

    const response = await app!.inject({
      method: 'POST',
      url: '/admin/restore/area',
      headers: { cookie },
      payload: {
        scopeType: 'room',
        roomPublicId: first.room.publicId,
        dailyCanvasId: first.dailyCanvas.id,
        canvasId: first.canvas.id,
        fromX: 2,
        fromY: 3,
        toX: 2,
        toY: 3,
        colorHex: '#FFFFFF',
        reason: 'room scoped reset'
      }
    });

    expect(response.statusCode).toBe(200);
    const firstPixel = await pool.query('SELECT color_hex FROM pixels WHERE canvas_id = $1 AND x = 2 AND y = 3', [first.canvas.id]);
    const secondPixel = await pool.query('SELECT color_hex FROM pixels WHERE canvas_id = $1 AND x = 2 AND y = 3', [second.canvas.id]);
    expect(firstPixel.rows[0]?.color_hex).toBe('#FFFFFF');
    expect(secondPixel.rows[0]?.color_hex).toBe('#22C55E');
    expect(broadcastPixelUpdated).toHaveBeenCalledWith(expect.objectContaining({
      roomPublicId: first.room.publicId,
      dailyCanvasId: first.dailyCanvas.id,
      canvasId: first.canvas.id,
      x: 2,
      y: 3,
      colorHex: '#FFFFFF'
    }));
  });

  it('writes admin audit records with room and canvas scope', async () => {
    const cookie = await loginAdminCookie();
    const room = await createRoomWithTodayCanvas(pool, {
      name: `${TEST_ROOM_PREFIX} audit`,
      ownerActorKey: TEST_ROOM_ACTOR_A,
      inviteSecret: testConfig().cookieSecret,
      publicIdPrefix: `${TEST_ROOM_PREFIX}-audit`
    });

    const response = await app!.inject({
      method: 'POST',
      url: '/admin/restore/area',
      headers: { cookie },
      payload: {
        scopeType: 'room',
        roomPublicId: room.room.publicId,
        dailyCanvasId: room.dailyCanvas.id,
        canvasId: room.canvas.id,
        fromX: 4,
        fromY: 5,
        toX: 4,
        toY: 5,
        colorHex: '#38bdf8',
        reason: 'room audit reset'
      }
    });

    expect(response.statusCode).toBe(200);
    const adminAction = await pool.query(
      `SELECT scope_type, room_id, daily_canvas_id, canvas_id, metadata
       FROM admin_actions
       WHERE action_type = 'restore_area' AND metadata->>'reason' = 'room audit reset'
       ORDER BY created_at DESC
       LIMIT 1`
    );
    expect(adminAction.rows[0]).toEqual(expect.objectContaining({
      scope_type: 'room',
      room_id: room.room.id,
      daily_canvas_id: room.dailyCanvas.id,
      canvas_id: room.canvas.id,
      metadata: expect.objectContaining({ reason: 'room audit reset', colorHex: '#38BDF8', count: 1 })
    }));
  });

  it.each([
    [
      'too large',
      { fromX: 0, fromY: 0, toX: 99, toY: 99, colorHex: '#22C55E', reason: 'spam cleanup' },
      { error: 'restore_area_too_large' }
    ],
    [
      'out of bounds',
      { fromX: 0, fromY: 0, toX: 100, toY: 1, colorHex: '#22C55E', reason: 'spam cleanup' },
      { error: 'invalid_restore_request' }
    ],
    [
      'invalid color',
      { fromX: 19, fromY: 20, toX: 20, toY: 21, colorHex: 'nope', reason: 'spam cleanup' },
      { error: 'invalid_restore_request' }
    ],
    [
      'blank reason',
      { fromX: 19, fromY: 20, toX: 20, toY: 21, colorHex: '#22C55E', reason: '   ' },
      { error: 'invalid_restore_request' }
    ]
  ])('rejects invalid restore-area requests: %s', async (_caseName, payload, expectedBody) => {
    const cookie = await loginAdminCookie();

    const before = await pool.query(
      `SELECT count(*)::int AS count
       FROM admin_actions
       WHERE action_type = 'restore_area' AND target_summary = '19,20-20,21'`
    );
    const response = await app!.inject({
      method: 'POST',
      url: '/admin/restore/area',
      headers: { cookie },
      payload
    });
    const after = await pool.query(
      `SELECT count(*)::int AS count
       FROM admin_actions
       WHERE action_type = 'restore_area' AND target_summary = '19,20-20,21'`
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(expectedBody);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });



  it.each([
    ['room restore with no selector', '/admin/restore/area', {
      scopeType: 'room',
      fromX: 1,
      fromY: 1,
      toX: 1,
      toY: 1,
      colorHex: '#22C55E',
      reason: 'room scoped reset'
    }],
    ['room restore with only canvas selector', '/admin/restore/area', {
      scopeType: 'room',
      canvasId: 'room-not-a-room-selector',
      fromX: 1,
      fromY: 1,
      toX: 1,
      toY: 1,
      colorHex: '#22C55E',
      reason: 'room scoped reset'
    }],
    ['daily canvas restore with only room selector', '/admin/restore/area', {
      scopeType: 'daily_canvas',
      roomPublicId: 'room_selector_without_daily_canvas',
      fromX: 1,
      fromY: 1,
      toX: 1,
      toY: 1,
      colorHex: '#22C55E',
      reason: 'room scoped reset'
    }],
    ['canvas block with no selector', '/admin/blocks', {
      scopeType: 'canvas',
      actorKey: TEST_ACTOR_KEY,
      reason: INVALID_BLOCK_REASON,
      durationMinutes: 5
    }],
    ['canvas block with only room selector', '/admin/blocks', {
      scopeType: 'canvas',
      roomPublicId: 'room_selector_without_canvas',
      actorKey: TEST_ACTOR_KEY,
      reason: INVALID_BLOCK_REASON,
      durationMinutes: 5
    }],
    ['room block with malformed room UUID', '/admin/blocks', {
      scopeType: 'room',
      roomId: 'not-a-uuid',
      actorKey: TEST_ACTOR_KEY,
      reason: INVALID_BLOCK_REASON,
      durationMinutes: 5
    }],
    ['daily canvas block with malformed daily canvas UUID', '/admin/blocks', {
      scopeType: 'daily_canvas',
      dailyCanvasId: 'not-a-uuid',
      actorKey: TEST_ACTOR_KEY,
      reason: INVALID_BLOCK_REASON,
      durationMinutes: 5
    }]
  ])('rejects insufficient or malformed scoped admin requests: %s', async (_caseName, url, payload) => {
    const cookie = await loginAdminCookie();
    const beforeInvalidBlocks = await countInvalidBlockMutations();

    const response = await app!.inject({
      method: 'POST',
      url,
      headers: { cookie },
      payload
    });

    const afterInvalidBlocks = await countInvalidBlockMutations();
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_scope' });
    expect(afterInvalidBlocks).toBe(beforeInvalidBlocks);
  });

  it('creates canvas-scoped blocks with canvas scope columns and audit logs', async () => {
    const cookie = await loginAdminCookie();
    const room = await createRoomWithTodayCanvas(pool, {
      name: `${TEST_ROOM_PREFIX} canvas block`,
      ownerActorKey: TEST_ROOM_ACTOR_A,
      inviteSecret: testConfig().cookieSecret,
      publicIdPrefix: `${TEST_ROOM_PREFIX}-canvas-block`
    });

    const response = await app!.inject({
      method: 'POST',
      url: '/admin/blocks',
      headers: { cookie },
      payload: {
        scopeType: 'canvas',
        roomPublicId: room.room.publicId,
        dailyCanvasId: room.dailyCanvas.id,
        canvasId: room.canvas.id,
        actorKey: TEST_ACTOR_KEY,
        reason: 'canvas scoped block',
        durationMinutes: 10
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, expiresAt: expect.any(String) });

    const block = await pool.query(
      `SELECT scope_type, room_id, daily_canvas_id, canvas_id, reason
       FROM blocks
       WHERE actor_key = $1 AND reason = 'canvas scoped block'
       ORDER BY created_at DESC
       LIMIT 1`,
      [TEST_ACTOR_KEY]
    );
    expect(block.rows[0]).toEqual(expect.objectContaining({
      scope_type: 'canvas',
      room_id: room.room.id,
      daily_canvas_id: room.dailyCanvas.id,
      canvas_id: room.canvas.id,
      reason: 'canvas scoped block'
    }));

    const adminAction = await pool.query(
      `SELECT scope_type, room_id, daily_canvas_id, canvas_id, metadata
       FROM admin_actions
       WHERE action_type = 'block_actor' AND metadata->>'reason' = 'canvas scoped block'
       ORDER BY created_at DESC
       LIMIT 1`
    );
    expect(adminAction.rows[0]).toEqual(expect.objectContaining({
      scope_type: 'canvas',
      room_id: room.room.id,
      daily_canvas_id: room.dailyCanvas.id,
      canvas_id: room.canvas.id,
      metadata: expect.objectContaining({ reason: 'canvas scoped block' })
    }));
  });

  it('archives a room with room-scoped admin audit', async () => {
    const cookie = await loginAdminCookie();
    const room = await createRoomWithTodayCanvas(pool, {
      name: `${TEST_ROOM_PREFIX} archive`,
      ownerActorKey: TEST_ROOM_ACTOR_A,
      inviteSecret: testConfig().cookieSecret,
      publicIdPrefix: `${TEST_ROOM_PREFIX}-archive`
    });

    const response = await app!.inject({
      method: 'POST',
      url: `/admin/rooms/${room.room.publicId}/archive`,
      headers: { cookie },
      payload: { reason: 'room audit reset' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    const roomRow = await pool.query('SELECT archived_at FROM rooms WHERE id = $1', [room.room.id]);
    expect(roomRow.rows[0]?.archived_at).toBeInstanceOf(Date);

    const adminAction = await pool.query(
      `SELECT scope_type, room_id, daily_canvas_id, canvas_id, metadata
       FROM admin_actions
       WHERE action_type = 'archive_room' AND target_summary = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [room.room.publicId]
    );
    expect(adminAction.rows[0]).toEqual(expect.objectContaining({
      scope_type: 'room',
      room_id: room.room.id,
      daily_canvas_id: room.dailyCanvas.id,
      canvas_id: room.canvas.id,
      metadata: { reason: 'room audit reset' }
    }));
  });

  it.each([
    ['number actorKey', { actorKey: 123, reason: INVALID_BLOCK_REASON, durationMinutes: 5 }],
    ['object actorKey', { actorKey: { value: TEST_ACTOR_KEY }, reason: INVALID_BLOCK_REASON, durationMinutes: 5 }],
    ['blank actorKey', { actorKey: '   ', reason: INVALID_BLOCK_REASON, durationMinutes: 5 }],
    ['malformed ip hash', { actorIpHash: 'not-a-hex-hash', reason: INVALID_BLOCK_REASON, durationMinutes: 5 }],
    ['huge duration', { actorKey: TEST_ACTOR_KEY, reason: INVALID_BLOCK_REASON, durationMinutes: 1e100 }],
    ['blank reason', { actorKey: TEST_ACTOR_KEY, reason: '   ', durationMinutes: 5 }],
    [
      'invalid actorKey with valid ip hash',
      { actorKey: 'not-valid', actorIpHash: TEST_ACTOR_IP_HASH, reason: INVALID_BLOCK_REASON, durationMinutes: 5 }
    ],
    [
      'valid actorKey with invalid ip hash',
      { actorKey: TEST_ACTOR_KEY, actorIpHash: 'not-valid', reason: INVALID_BLOCK_REASON, durationMinutes: 5 }
    ]
  ])('rejects invalid block requests without DB mutation: %s', async (_caseName, payload) => {
    const cookie = await loginAdminCookie();
    const before = await countInvalidBlockMutations();

    const invalid = await app!.inject({
      method: 'POST',
      url: '/admin/blocks',
      headers: { cookie },
      payload
    });

    const after = await countInvalidBlockMutations();
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: 'invalid_block_request' });
    expect(after).toBe(before);
  });

  it('normalizes uppercase IP-only block hashes before storing them', async () => {
    const cookie = await loginAdminCookie();
    const uppercaseHash = TEST_ACTOR_IP_HASH.toUpperCase();
    const reason = 'uppercase ip-only block';

    const valid = await app!.inject({
      method: 'POST',
      url: '/admin/blocks',
      headers: { cookie },
      payload: {
        actorIpHash: uppercaseHash,
        reason,
        durationMinutes: 5
      }
    });

    expect(valid.statusCode).toBe(200);

    const block = await pool.query(
      `SELECT actor_ip_hash
       FROM blocks
       WHERE reason = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [reason]
    );
    expect(block.rows[0]?.actor_ip_hash).toBe(TEST_ACTOR_IP_HASH);

    const exactMatch = await pool.query(
      `SELECT 1
       FROM blocks
       WHERE actor_ip_hash = $1 AND expires_at > now()
       LIMIT 1`,
      [TEST_ACTOR_IP_HASH]
    );
    expect(exactMatch.rowCount).toBe(1);
  });

  it('creates valid blocks with audit logs', async () => {
    const cookie = await loginAdminCookie();

    const valid = await app!.inject({
      method: 'POST',
      url: '/admin/blocks',
      headers: { cookie },
      payload: {
        actorKey: ` ${TEST_ACTOR_KEY} `,
        actorIpHash: ` ${TEST_ACTOR_IP_HASH.toUpperCase()} `,
        reason: ' admin route test block ',
        durationMinutes: 10
      }
    });

    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ ok: true, expiresAt: expect.any(String) });

    const block = await pool.query(
      `SELECT reason, expires_at
       FROM blocks
       WHERE actor_key = $1 AND actor_ip_hash = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [TEST_ACTOR_KEY, TEST_ACTOR_IP_HASH]
    );
    expect(block.rows[0]?.reason).toBe('admin route test block');
    expect(new Date(block.rows[0]?.expires_at).getTime()).toBeGreaterThan(Date.now());

    const adminAction = await pool.query(
      `SELECT target_summary, metadata
       FROM admin_actions
       WHERE action_type = 'block_actor' AND target_summary = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [TEST_ACTOR_KEY]
    );
    expect(adminAction.rows[0]).toEqual(
      expect.objectContaining({
        target_summary: TEST_ACTOR_KEY,
        metadata: expect.objectContaining({ reason: 'admin route test block' })
      })
    );
  });
});
