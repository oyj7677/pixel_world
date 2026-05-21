import type { AddressInfo } from 'node:net';
import { sign } from '@fastify/cookie';
import {
  DEFAULT_CANVAS_ID,
  type CanvasSnapshotPayload,
  type PixelUpdatedPayload,
  type PresenceUpdatedPayload,
  type RecentEventsUpdatedPayload
} from '@pixel-world/shared';
import { io as connectClient, type ManagerOptions, type Socket as ClientSocket, type SocketOptions } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACTOR_COOKIE } from '../src/auth/actorIdentity';
import { ADMIN_COOKIE } from '../src/auth/adminSession';
import { createBlock, upsertPixelAndLog } from '../src/db/canvasRepository';
import { buildApp } from '../src/app';
import { loadConfig, type ServerConfig } from '../src/config';
import { createDbPool, type DbPool } from '../src/db/index';
import { runMigrations } from '../src/db/migrate';
import { attachRealtimeSocketServer } from '../src/realtime/socketServer';
import {
  createRoomWithTodayCanvas,
  ensureRoomMember,
  type CreatedRoomWithTodayCanvas
} from '../src/rooms/roomRepository';

const TEST_PREFIX = `room-socket-test-${process.pid}`;
const ACTOR_IP_HASH = '1'.repeat(64);

let pool: DbPool;
let config: ServerConfig;
let baselineConfig: ServerConfig;
let app: Awaited<ReturnType<typeof buildApp>> | null = null;
let clients: ClientSocket[] = [];
const initialSnapshots = new WeakMap<ClientSocket, Promise<CanvasSnapshotPayload>>();
let roomCounter = 0;
let actorCounter = 0;

function testActorKey(): string {
  actorCounter += 1;
  return `act_${actorCounter.toString(16).padStart(32, '0')}`;
}

function waitForEvent<T>(socket: ClientSocket, eventName: string, timeoutMs = 1500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, onEvent);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    function onEvent(payload: T) {
      clearTimeout(timeout);
      resolve(payload);
    }

    socket.once(eventName, onEvent);
  });
}

function waitForNoEvent(socket: ClientSocket, eventName: string, timeoutMs = 200): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, onEvent);
      resolve();
    }, timeoutMs);

    function onEvent(payload: unknown) {
      clearTimeout(timeout);
      reject(new Error(`Unexpected ${eventName}: ${JSON.stringify(payload)}`));
    }

    socket.once(eventName, onEvent);
  });
}

function cookieForActor(actorKey: string): string {
  return `${ACTOR_COOKIE}=${sign(actorKey, config.cookieSecret)}`;
}

function getAdminCookie(setCookie: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = cookies.find((value) => value.startsWith(`${ADMIN_COOKIE}=`));
  expect(cookie).toBeDefined();
  return cookie!.split(';')[0]!;
}

async function cleanupRoomSocketTestData(): Promise<void> {
  await pool.query(
    `DELETE FROM analytics_events
     WHERE room_public_id LIKE $1 OR actor_key LIKE $1 OR properties::text LIKE $2`,
    [`${TEST_PREFIX}%`, `%${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM pixel_events
     WHERE canvas_id = $1
        OR canvas_id IN (
          SELECT dc.canvas_id
          FROM daily_canvases dc
          JOIN rooms r ON r.id = dc.room_id
          WHERE r.public_id LIKE $2 OR r.owner_actor_key LIKE $2 OR r.name LIKE $2
        )`,
    [DEFAULT_CANVAS_ID, `${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM pixels
     WHERE canvas_id = $1
        OR canvas_id IN (
          SELECT dc.canvas_id
          FROM daily_canvases dc
          JOIN rooms r ON r.id = dc.room_id
          WHERE r.public_id LIKE $2 OR r.owner_actor_key LIKE $2 OR r.name LIKE $2
        )`,
    [DEFAULT_CANVAS_ID, `${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM blocks
     WHERE actor_key LIKE $1
        OR room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key LIKE $1 OR name LIKE $1)`,
    [`${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM room_invite_uses
     WHERE actor_key LIKE $1
        OR room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key LIKE $1 OR name LIKE $1)`,
    [`${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM room_pixel_allowances
     WHERE actor_key LIKE $1
        OR room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key LIKE $1 OR name LIKE $1)`,
    [`${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM room_invites
     WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key LIKE $1 OR name LIKE $1)`,
    [`${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM room_members
     WHERE actor_key LIKE $1
        OR room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key LIKE $1 OR name LIKE $1)`,
    [`${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM daily_canvases
     WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key LIKE $1 OR name LIKE $1)`,
    [`${TEST_PREFIX}%`]
  );
  await pool.query('DELETE FROM canvases WHERE id LIKE $1 OR slug LIKE $1', [`room_${TEST_PREFIX}%`]);
  await pool.query('DELETE FROM rooms WHERE public_id LIKE $1 OR owner_actor_key LIKE $1 OR name LIKE $1', [
    `${TEST_PREFIX}%`
  ]);
}

async function dbTodayAtNoonUtc(): Promise<Date> {
  const result = await pool.query<{ today: string }>("SELECT ((now() AT TIME ZONE 'UTC')::date)::text AS today");
  return new Date(`${result.rows[0]!.today}T12:00:00.000Z`);
}

async function createTestRoom(
  overrides: Partial<Parameters<typeof createRoomWithTodayCanvas>[1]> = {}
): Promise<CreatedRoomWithTodayCanvas> {
  roomCounter += 1;
  return createRoomWithTodayCanvas(pool, {
    name: `${TEST_PREFIX} room ${roomCounter}`,
    ownerActorKey: testActorKey(),
    inviteSecret: config.cookieSecret,
    publicIdPrefix: `${TEST_PREFIX}-${roomCounter}`,
    today: await dbTodayAtNoonUtc(),
    timezone: 'UTC',
    expectedParticipantCount: 4,
    targetCompletionMs: 60 * 60 * 1000,
    pixelAllowanceMaxStorageMs: 60 * 60 * 1000,
    ...overrides
  });
}

async function addMember(room: CreatedRoomWithTodayCanvas, actorKey: string): Promise<void> {
  await ensureRoomMember(pool, {
    roomId: room.room.id,
    actorKey,
    role: 'guest',
    inviteId: room.invite.id
  });
}

async function startSocketServer(): Promise<string> {
  app = await buildApp({ ...config, port: 0 });
  attachRealtimeSocketServer(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function roomQuery(room: CreatedRoomWithTodayCanvas, extra: Record<string, string> = {}) {
  return {
    roomPublicId: room.room.publicId,
    dailyCanvasId: room.dailyCanvas.id,
    ...extra
  };
}


function waitForSnapshot(socket: ClientSocket): Promise<CanvasSnapshotPayload> {
  return initialSnapshots.get(socket) ?? waitForEvent<CanvasSnapshotPayload>(socket, 'canvasSnapshot');
}

async function connectToServer(
  url: string,
  options: Partial<ManagerOptions & SocketOptions> = {}
): Promise<ClientSocket> {
  const socket = connectClient(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    ...options
  });
  const initialSnapshot = waitForEvent<CanvasSnapshotPayload>(socket, 'canvasSnapshot');
  initialSnapshot.catch(() => undefined);
  initialSnapshots.set(socket, initialSnapshot);
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      reject(new Error('Timed out waiting for connect'));
    }, 1500);

    function cleanup() {
      clearTimeout(timeout);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
    }

    function onConnect() {
      cleanup();
      resolve();
    }

    function onConnectError(error: Error) {
      cleanup();
      reject(error);
    }

    socket.once('connect', onConnect);
    socket.once('connect_error', onConnectError);
  });
  return socket;
}

beforeAll(async () => {
  await runMigrations();
  config = loadConfig();
  baselineConfig = { ...config, policy: { ...config.policy } };
  pool = createDbPool(config);
});

beforeEach(async () => {
  config = { ...baselineConfig, policy: { ...baselineConfig.policy } };
  await cleanupRoomSocketTestData();
});

afterEach(async () => {
  for (const client of clients) {
    client.disconnect();
  }
  clients = [];
  if (app) {
    await app.close();
    app = null;
  }
  await cleanupRoomSocketTestData();
});

afterAll(async () => {
  await cleanupRoomSocketTestData();
  await pool.end();
});

describe('room-scoped Socket.IO realtime', () => {
  it('lets same-room clients receive room pixel updates', async () => {
    const room = await createTestRoom();
    const actorA = testActorKey();
    const actorB = testActorKey();
    await addMember(room, actorA);
    const url = await startSocketServer();
    const sender = await connectToServer(url, {
      query: roomQuery(room),
      extraHeaders: { Cookie: cookieForActor(actorA) }
    });
    const observer = await connectToServer(url, {
      query: roomQuery(room, { inviteToken: room.invite.rawToken }),
      extraHeaders: { Cookie: cookieForActor(actorB) }
    });
    await Promise.all([
      waitForSnapshot(sender),
      waitForSnapshot(observer)
    ]);

    const pixelUpdated = waitForEvent<PixelUpdatedPayload>(observer, 'pixelUpdated');
    const roomRecent = waitForEvent<RecentEventsUpdatedPayload>(observer, 'roomRecentEventsUpdated');
    const myRecent = waitForEvent<RecentEventsUpdatedPayload>(sender, 'myRecentEventsUpdated');
    sender.emit('placePixel', {
      roomPublicId: room.room.publicId,
      dailyCanvasId: room.dailyCanvas.id,
      canvasId: room.canvas.id,
      x: 2,
      y: 3,
      colorHex: '#38bdf8'
    });

    await expect(pixelUpdated).resolves.toEqual(
      expect.objectContaining({
        roomPublicId: room.room.publicId,
        dailyCanvasId: room.dailyCanvas.id,
        canvasId: room.canvas.id,
        x: 2,
        y: 3,
        colorHex: '#38BDF8'
      })
    );
    await expect(roomRecent).resolves.toEqual(
      expect.objectContaining({
        roomPublicId: room.room.publicId,
        dailyCanvasId: room.dailyCanvas.id,
        events: [expect.objectContaining({ x: 2, y: 3, newColorHex: '#38BDF8' })]
      })
    );
    await expect(myRecent).resolves.toEqual(
      expect.objectContaining({
        roomPublicId: room.room.publicId,
        dailyCanvasId: room.dailyCanvas.id,
        events: [expect.objectContaining({ x: 2, y: 3, newColorHex: '#38BDF8' })]
      })
    );
  });

  it('prevents Room A clients from receiving Room B pixel updates', async () => {
    const roomA = await createTestRoom();
    const roomB = await createTestRoom();
    const actorA = testActorKey();
    const actorB = testActorKey();
    await addMember(roomA, actorA);
    await addMember(roomB, actorB);
    const url = await startSocketServer();
    const roomAClient = await connectToServer(url, {
      query: roomQuery(roomA),
      extraHeaders: { Cookie: cookieForActor(actorA) }
    });
    const roomBSender = await connectToServer(url, {
      query: roomQuery(roomB),
      extraHeaders: { Cookie: cookieForActor(actorB) }
    });
    await Promise.all([
      waitForSnapshot(roomAClient),
      waitForSnapshot(roomBSender)
    ]);

    const noPixelUpdate = waitForNoEvent(roomAClient, 'pixelUpdated');
    const noRoomRecent = waitForNoEvent(roomAClient, 'roomRecentEventsUpdated');
    const roomBPixelUpdate = waitForEvent<PixelUpdatedPayload>(roomBSender, 'pixelUpdated');
    roomBSender.emit('placePixel', {
      roomPublicId: roomB.room.publicId,
      dailyCanvasId: roomB.dailyCanvas.id,
      canvasId: roomB.canvas.id,
      x: 4,
      y: 5,
      colorHex: '#ef4444'
    });

    await expect(roomBPixelUpdate).resolves.toEqual(
      expect.objectContaining({ canvasId: roomB.canvas.id, x: 4, y: 5, colorHex: '#EF4444' })
    );
    await expect(noPixelUpdate).resolves.toBeUndefined();
    await expect(noRoomRecent).resolves.toBeUndefined();
  });

  it('prevents cross-room presence leakage', async () => {
    const roomA = await createTestRoom();
    const roomB = await createTestRoom();
    const actorA1 = testActorKey();
    const actorA2 = testActorKey();
    const actorB = testActorKey();
    await addMember(roomA, actorA1);
    await addMember(roomA, actorA2);
    await addMember(roomB, actorB);
    const url = await startSocketServer();
    const roomAClient = await connectToServer(url, {
      query: roomQuery(roomA),
      extraHeaders: { Cookie: cookieForActor(actorA1) }
    });
    await expect(waitForSnapshot(roomAClient)).resolves.toEqual(
      expect.objectContaining({ onlineCount: 1 })
    );

    const roomAPresence = waitForEvent<PresenceUpdatedPayload>(roomAClient, 'presenceUpdated');
    const roomASecond = await connectToServer(url, {
      query: roomQuery(roomA),
      extraHeaders: { Cookie: cookieForActor(actorA2) }
    });
    await expect(waitForSnapshot(roomASecond)).resolves.toEqual(
      expect.objectContaining({ onlineCount: 2 })
    );
    await expect(roomAPresence).resolves.toEqual({ onlineCount: 2 });

    const noRoomAPresenceFromRoomB = waitForNoEvent(roomAClient, 'presenceUpdated');
    const roomBClient = await connectToServer(url, {
      query: roomQuery(roomB),
      extraHeaders: { Cookie: cookieForActor(actorB) }
    });
    await expect(waitForSnapshot(roomBClient)).resolves.toEqual(
      expect.objectContaining({ onlineCount: 1 })
    );
    await expect(noRoomAPresenceFromRoomB).resolves.toBeUndefined();
  });

  it('rejects socket join without membership or valid invite', async () => {
    const room = await createTestRoom();
    const url = await startSocketServer();

    await expect(
      connectToServer(url, {
        query: roomQuery(room, { date: 'today' }),
        extraHeaders: { Cookie: cookieForActor(testActorKey()) }
      })
    ).rejects.toThrow(/room_join_rejected|websocket error|xhr poll error/);
  });

  it('lets invite-token sockets place room pixels when the browser has no API cookie', async () => {
    const room = await createTestRoom();
    const inviteOnlyActor = testActorKey();
    const memberActor = testActorKey();
    await addMember(room, memberActor);
    const url = await startSocketServer();
    const inviteOnlyClient = await connectToServer(url, {
      query: roomQuery(room, { inviteToken: room.invite.rawToken }),
      extraHeaders: { Cookie: cookieForActor(inviteOnlyActor) }
    });
    const memberClient = await connectToServer(url, {
      query: roomQuery(room),
      extraHeaders: { Cookie: cookieForActor(memberActor) }
    });
    await Promise.all([waitForSnapshot(inviteOnlyClient), waitForSnapshot(memberClient)]);

    const broadcast = waitForEvent<PixelUpdatedPayload>(memberClient, 'pixelUpdated');
    inviteOnlyClient.emit('placePixel', {
      roomPublicId: room.room.publicId,
      dailyCanvasId: room.dailyCanvas.id,
      canvasId: room.canvas.id,
      x: 8,
      y: 9,
      colorHex: '#8b5cf6'
    });

    await expect(broadcast).resolves.toEqual(expect.objectContaining({
      roomPublicId: room.room.publicId,
      dailyCanvasId: room.dailyCanvas.id,
      canvasId: room.canvas.id,
      x: 8,
      y: 9,
      colorHex: '#8B5CF6'
    }));
    const persisted = await pool.query('SELECT 1 FROM pixels WHERE canvas_id = $1 AND x = $2 AND y = $3', [
      room.canvas.id,
      8,
      9
    ]);
    expect(persisted.rowCount).toBe(1);
  });

  it('lets room members place multiple pixels immediately in temporary unlimited mode', async () => {
    config = {
      ...config,
      unlimitedPixelPlacement: true,
    };
    const room = await createTestRoom({ pixelAllowanceMaxStorageMs: 1 });
    const actor = testActorKey();
    await addMember(room, actor);
    const url = await startSocketServer();
    const memberClient = await connectToServer(url, {
      query: roomQuery(room),
      extraHeaders: { Cookie: cookieForActor(actor) }
    });
    await waitForSnapshot(memberClient);

    const firstUpdate = waitForEvent<PixelUpdatedPayload>(memberClient, 'pixelUpdated');
    const firstCooldown = waitForEvent(memberClient, 'cooldownUpdated');
    memberClient.emit('placePixel', {
      roomPublicId: room.room.publicId,
      dailyCanvasId: room.dailyCanvas.id,
      canvasId: room.canvas.id,
      x: 8,
      y: 9,
      colorHex: '#22c55e'
    });
    await expect(firstUpdate).resolves.toEqual(expect.objectContaining({ x: 8, y: 9, colorHex: '#22C55E' }));
    await firstCooldown;

    const secondUpdate = waitForEvent<PixelUpdatedPayload>(memberClient, 'pixelUpdated');
    const noRejection = waitForNoEvent(memberClient, 'placementRejected');
    memberClient.emit('placePixel', {
      roomPublicId: room.room.publicId,
      dailyCanvasId: room.dailyCanvas.id,
      canvasId: room.canvas.id,
      x: 9,
      y: 9,
      colorHex: '#8b5cf6'
    });

    await expect(secondUpdate).resolves.toEqual(expect.objectContaining({ x: 9, y: 9, colorHex: '#8B5CF6' }));
    await expect(noRejection).resolves.toBeUndefined();
  });

  it('rejects manual room placement after an already-joined room is archived', async () => {
    const room = await createTestRoom();
    const actor = testActorKey();
    await addMember(room, actor);
    const url = await startSocketServer();
    const memberClient = await connectToServer(url, {
      query: roomQuery(room),
      extraHeaders: { Cookie: cookieForActor(actor) }
    });
    await waitForSnapshot(memberClient);

    await pool.query('UPDATE rooms SET archived_at = now() WHERE id = $1', [room.room.id]);

    const rejected = waitForEvent(memberClient, 'placementRejected');
    const noBroadcast = waitForNoEvent(memberClient, 'pixelUpdated');
    memberClient.emit('placePixel', {
      roomPublicId: room.room.publicId,
      dailyCanvasId: room.dailyCanvas.id,
      canvasId: room.canvas.id,
      x: 11,
      y: 12,
      colorHex: '#8b5cf6'
    });

    await expect(rejected).resolves.toEqual(
      expect.objectContaining({ reason: 'invalid_canvas', message: 'Room canvas is no longer accepting pixels.' })
    );
    await expect(noBroadcast).resolves.toBeUndefined();
    const persisted = await pool.query('SELECT 1 FROM pixels WHERE canvas_id = $1 AND x = $2 AND y = $3', [
      room.canvas.id,
      11,
      12
    ]);
    expect(persisted.rowCount).toBe(0);
  });

  it('rejects manual room placement after the joined daily canvas is sealed', async () => {
    const room = await createTestRoom();
    const actor = testActorKey();
    await addMember(room, actor);
    const url = await startSocketServer();
    const memberClient = await connectToServer(url, {
      query: roomQuery(room),
      extraHeaders: { Cookie: cookieForActor(actor) }
    });
    await waitForSnapshot(memberClient);

    await pool.query("UPDATE daily_canvases SET status = 'sealed' WHERE id = $1", [room.dailyCanvas.id]);

    const rejected = waitForEvent(memberClient, 'placementRejected');
    const noBroadcast = waitForNoEvent(memberClient, 'pixelUpdated');
    memberClient.emit('placePixel', {
      roomPublicId: room.room.publicId,
      dailyCanvasId: room.dailyCanvas.id,
      canvasId: room.canvas.id,
      x: 13,
      y: 14,
      colorHex: '#8b5cf6'
    });

    await expect(rejected).resolves.toEqual(
      expect.objectContaining({ reason: 'invalid_canvas', message: 'Room canvas is no longer accepting pixels.' })
    );
    await expect(noBroadcast).resolves.toBeUndefined();
    const persisted = await pool.query('SELECT 1 FROM pixels WHERE canvas_id = $1 AND x = $2 AND y = $3', [
      room.canvas.id,
      13,
      14
    ]);
    expect(persisted.rowCount).toBe(0);
  });

  it('emits Quick Pixel personal recent activity only to the placing room actor', async () => {
    const room = await createTestRoom();
    const placingActor = testActorKey();
    const observerActor = testActorKey();
    await addMember(room, observerActor);
    const url = await startSocketServer();
    const placingClient = await connectToServer(url, {
      query: {
        roomPublicId: room.room.publicId,
        date: 'today',
        inviteToken: room.invite.rawToken
      },
      extraHeaders: { Cookie: cookieForActor(placingActor) }
    });
    const observer = await connectToServer(url, {
      query: roomQuery(room),
      extraHeaders: { Cookie: cookieForActor(observerActor) }
    });
    await Promise.all([waitForSnapshot(placingClient), waitForSnapshot(observer)]);

    const placingPersonalRecent = waitForEvent<RecentEventsUpdatedPayload>(placingClient, 'myRecentEventsUpdated');
    const observerPersonalRecent = waitForNoEvent(observer, 'myRecentEventsUpdated');
    const observerPixel = waitForEvent<PixelUpdatedPayload>(observer, 'pixelUpdated');
    const observerRoomRecent = waitForEvent<RecentEventsUpdatedPayload>(observer, 'roomRecentEventsUpdated');

    const response = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${room.room.publicId}/quick-pixel`,
      payload: { inviteToken: room.invite.rawToken, suggestedColorHex: '#22c55e', displayName: '초대 손님' },
      headers: { cookie: cookieForActor(placingActor), 'x-forwarded-for': '203.0.113.9' }
    });

    expect(response.statusCode).toBe(201);
    const quickPixel = response.json<{ x: number; y: number; canvasId: string; roomPublicId: string }>();
    expect(quickPixel).not.toHaveProperty('actorKey');

    await expect(observerPixel).resolves.toEqual(
      expect.objectContaining({
        roomPublicId: room.room.publicId,
        dailyCanvasId: room.dailyCanvas.id,
        canvasId: room.canvas.id,
        x: quickPixel.x,
        y: quickPixel.y,
        colorHex: '#22C55E'
      })
    );

    const roomRecent = await observerRoomRecent;
    expect(roomRecent).toEqual(
      expect.objectContaining({
        roomPublicId: room.room.publicId,
        dailyCanvasId: room.dailyCanvas.id,
        events: [expect.objectContaining({ x: quickPixel.x, y: quickPixel.y, newColorHex: '#22C55E' })]
      })
    );
    expect(roomRecent.events[0]).not.toHaveProperty('actorKey');
    expect(roomRecent.events[0]).not.toHaveProperty('actorIpHash');

    const personalRecent = await placingPersonalRecent;
    expect(personalRecent).toEqual(
      expect.objectContaining({
        roomPublicId: room.room.publicId,
        dailyCanvasId: room.dailyCanvas.id,
        events: [expect.objectContaining({ x: quickPixel.x, y: quickPixel.y, newColorHex: '#22C55E' })]
      })
    );
    expect(personalRecent.events[0]).not.toHaveProperty('actorKey');
    expect(personalRecent.events[0]).not.toHaveProperty('actorIpHash');
    await expect(observerPersonalRecent).resolves.toBeUndefined();
  });


  it('includes initial room recent events separately from personal recent activity', async () => {
    const room = await createTestRoom();
    const actor = testActorKey();
    const otherActor = testActorKey();
    await addMember(room, actor);
    await upsertPixelAndLog(pool, {
      canvasId: room.canvas.id,
      x: 3,
      y: 4,
      colorHex: '#F97316',
      actorKey: otherActor,
      actorIpHash: ACTOR_IP_HASH,
      source: 'user'
    });
    await upsertPixelAndLog(pool, {
      canvasId: room.canvas.id,
      x: 5,
      y: 6,
      colorHex: '#38BDF8',
      actorKey: actor,
      actorIpHash: ACTOR_IP_HASH,
      source: 'user'
    });
    const url = await startSocketServer();

    const socket = await connectToServer(url, {
      query: roomQuery(room),
      extraHeaders: { Cookie: cookieForActor(actor) }
    });
    const snapshot = await waitForSnapshot(socket);

    expect(snapshot.recentEvents).toEqual([
      expect.objectContaining({ x: 5, y: 6, newColorHex: '#38BDF8' })
    ]);
    expect(snapshot.roomRecentEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 3, y: 4, newColorHex: '#F97316' }),
      expect.objectContaining({ x: 5, y: 6, newColorHex: '#38BDF8' })
    ]));
  });

  it('enforces canvas-scoped blocks only on the matching room canvas', async () => {
    const blockedActor = testActorKey();
    const roomA = await createTestRoom();
    const roomB = await createTestRoom();
    await addMember(roomA, blockedActor);
    await addMember(roomB, blockedActor);
    await createBlock(pool, {
      actorKey: blockedActor,
      reason: `${TEST_PREFIX} canvas scoped block`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      scopeType: 'canvas',
      roomId: roomA.room.id,
      dailyCanvasId: roomA.dailyCanvas.id,
      canvasId: roomA.canvas.id
    });
    const url = await startSocketServer();
    const roomAClient = await connectToServer(url, {
      query: roomQuery(roomA),
      extraHeaders: { Cookie: cookieForActor(blockedActor) }
    });
    const roomBClient = await connectToServer(url, {
      query: roomQuery(roomB),
      extraHeaders: { Cookie: cookieForActor(blockedActor) }
    });
    await Promise.all([waitForSnapshot(roomAClient), waitForSnapshot(roomBClient)]);

    const rejected = waitForEvent(roomAClient, 'placementRejected');
    const roomBPixel = waitForEvent<PixelUpdatedPayload>(roomBClient, 'pixelUpdated');
    const roomBRecent = waitForEvent<RecentEventsUpdatedPayload>(roomBClient, 'roomRecentEventsUpdated');
    const roomBMyRecent = waitForEvent<RecentEventsUpdatedPayload>(roomBClient, 'myRecentEventsUpdated');
    roomAClient.emit('placePixel', {
      roomPublicId: roomA.room.publicId,
      dailyCanvasId: roomA.dailyCanvas.id,
      canvasId: roomA.canvas.id,
      x: 9,
      y: 10,
      colorHex: '#ef4444'
    });
    roomBClient.emit('placePixel', {
      roomPublicId: roomB.room.publicId,
      dailyCanvasId: roomB.dailyCanvas.id,
      canvasId: roomB.canvas.id,
      x: 9,
      y: 10,
      colorHex: '#22c55e'
    });

    await expect(rejected).resolves.toEqual(
      expect.objectContaining({ reason: 'blocked', message: 'Pixel placement is blocked for this actor.' })
    );
    await expect(roomBPixel).resolves.toEqual(
      expect.objectContaining({ canvasId: roomB.canvas.id, x: 9, y: 10, colorHex: '#22C55E' })
    );
    await expect(roomBRecent).resolves.toEqual(expect.objectContaining({ dailyCanvasId: roomB.dailyCanvas.id }));
    await expect(roomBMyRecent).resolves.toEqual(expect.objectContaining({ dailyCanvasId: roomB.dailyCanvas.id }));
  });

  it('keeps global admin restore updates out of room sockets while global clients receive them', async () => {
    const room = await createTestRoom();
    const roomActor = testActorKey();
    await addMember(room, roomActor);
    const url = await startSocketServer();
    const roomClient = await connectToServer(url, {
      query: roomQuery(room),
      extraHeaders: { Cookie: cookieForActor(roomActor) }
    });
    const globalClient = await connectToServer(url);
    await Promise.all([waitForSnapshot(roomClient), waitForSnapshot(globalClient)]);

    const noRoomPixelUpdate = waitForNoEvent(roomClient, 'pixelUpdated');
    const globalPixelUpdate = waitForEvent<PixelUpdatedPayload>(globalClient, 'pixelUpdated');
    const login = await app!.inject({
      method: 'POST',
      url: '/admin/login',
      payload: { password: config.adminPassword }
    });
    const restore = await app!.inject({
      method: 'POST',
      url: '/admin/restore/area',
      headers: { cookie: getAdminCookie(login.headers['set-cookie']) },
      payload: {
        fromX: 10,
        fromY: 11,
        toX: 10,
        toY: 11,
        colorHex: '#ffffff',
        reason: 'room isolation regression'
      }
    });

    expect(restore.statusCode).toBe(200);
    await expect(globalPixelUpdate).resolves.toEqual(
      expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID, x: 10, y: 11, colorHex: '#FFFFFF' })
    );
    await expect(noRoomPixelUpdate).resolves.toBeUndefined();
  });

  it('keeps legacy global canvas socket behavior working', async () => {
    const url = await startSocketServer();
    const sender = await connectToServer(url);
    const observer = await connectToServer(url);
    await Promise.all([
      waitForSnapshot(sender),
      waitForSnapshot(observer)
    ]);

    const pixelUpdated = waitForEvent<PixelUpdatedPayload>(observer, 'pixelUpdated');
    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 6,
      y: 7,
      colorHex: '#22c55e'
    });

    await expect(pixelUpdated).resolves.toEqual(
      expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID, x: 6, y: 7, colorHex: '#22C55E' })
    );
  });
});
