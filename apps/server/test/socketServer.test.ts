import type { AddressInfo } from 'node:net';
import { sign } from '@fastify/cookie';
import {
  DEFAULT_CANVAS_ID,
  calculateDynamicAllowanceIntervalMs,
  calculateMaxSavedPixelCount,
  calculateRequiredPixelCount,
  type CanvasSnapshotPayload,
  type CooldownUpdatedPayload,
  type PixelUpdatedPayload,
  type PlacementRejectedPayload,
  type RecentEventsUpdatedPayload
} from '@pixel-world/shared';
import { io as connectClient, type ManagerOptions, type Socket as ClientSocket, type SocketOptions } from 'socket.io-client';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACTOR_COOKIE } from '../src/auth/actorIdentity';
import { ADMIN_COOKIE } from '../src/auth/adminSession';
import { buildApp } from '../src/app';
import { loadConfig, type ServerConfig } from '../src/config';
import { upsertPixelAndLog } from '../src/db/canvasRepository';
import { createDbPool, type DbPool } from '../src/db/index';
import { runMigrations } from '../src/db/migrate';
import { attachRealtimeSocketServer } from '../src/realtime/socketServer';

const TEST_COORDINATES = [
  [91, 91],
  [92, 91],
  [93, 91],
  [94, 91],
  [95, 91]
] as const;

let pool: DbPool;
let config: ServerConfig;
let baselineConfig: ServerConfig;
let app: Awaited<ReturnType<typeof buildApp>> | null = null;
let clients: ClientSocket[] = [];
const initialSnapshots = new WeakMap<ClientSocket, Promise<CanvasSnapshotPayload>>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function waitForNoEvent(socket: ClientSocket, eventName: string, timeoutMs = 150): Promise<void> {
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

async function clearSocketTestData(): Promise<void> {
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
}

async function startSocketServer(
  options: { delayCanvasSnapshotMs?: number; delayFirstBlockCheckMs?: number; failFirstPixelWrite?: boolean } = {}
): Promise<string> {
  app = await buildApp({
    ...config,
    port: 0
  });

  if (options.delayCanvasSnapshotMs) {
    const originalQuery = app.db.query.bind(app.db);
    app.db.query = (async (query: unknown, ...args: unknown[]) => {
      if (typeof query === 'string' && query.includes('FROM canvases WHERE id = $1')) {
        await delay(options.delayCanvasSnapshotMs!);
      }

      return originalQuery(query as never, ...(args as never[]));
    }) as typeof app.db.query;
  }

  if (options.delayFirstBlockCheckMs) {
    const originalQuery = app.db.query.bind(app.db);
    let delayedBlockCheck = false;
    app.db.query = (async (query: unknown, ...args: unknown[]) => {
      if (
        !delayedBlockCheck &&
        typeof query === 'string' &&
        query.includes('FROM blocks')
      ) {
        delayedBlockCheck = true;
        await delay(options.delayFirstBlockCheckMs!);
      }

      return originalQuery(query as never, ...(args as never[]));
    }) as typeof app.db.query;
  }

  if (options.failFirstPixelWrite) {
    const originalConnect = app.db.connect.bind(app.db) as {
      (): Promise<PoolClient>;
      (callback: (error: Error | undefined, client: PoolClient | undefined, release: (release?: unknown) => void) => void): void;
    };
    let failedPixelWrite = false;
    const patchedClients = new WeakSet<object>();
    const patchClient = (client: PoolClient): PoolClient => {
      if (patchedClients.has(client as unknown as object)) {
        return client;
      }

      patchedClients.add(client as unknown as object);
      const originalClientQuery = client.query.bind(client);
      client.query = (async (query: unknown, ...args: unknown[]) => {
        if (
          !failedPixelWrite &&
          typeof query === 'string' &&
          query.includes('INSERT INTO pixels')
        ) {
          failedPixelWrite = true;
          throw new Error('forced pixel write failure');
        }

        return originalClientQuery(query as never, ...(args as never[]));
      }) as typeof client.query;
      return client;
    };

    app.db.connect = ((callback?: unknown) => {
      if (typeof callback === 'function') {
        return originalConnect((error, client, release) => {
          callback(error, client ? patchClient(client) : client, release);
        });
      }

      return originalConnect().then(patchClient);
    }) as typeof app.db.connect;
  }

  attachRealtimeSocketServer(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
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
  await clearSocketTestData();
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
  await clearSocketTestData();
});

afterAll(async () => {
  await pool.end();
});

describe('Socket.IO pixel flow', () => {
  it('rejects websocket-only connections from a disallowed browser origin', async () => {
    const url = await startSocketServer();

    await expect(
      connectToServer(url, {
        extraHeaders: {
          Origin: 'http://evil.example'
        }
      })
    ).rejects.toThrow(/origin_not_allowed|websocket error|xhr poll error/);
  });

  it('allows websocket-only connections from the configured browser origin', async () => {
    const url = await startSocketServer();
    const client = await connectToServer(url, {
      extraHeaders: {
        Origin: config.webOrigin
      }
    });

    await expect(waitForSnapshot(client)).resolves.toEqual(
      expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID })
    );
  });
  it('sends canvasSnapshot with the actor pixel allowance policy and transition alias', async () => {
    const requiredPixelCount = calculateRequiredPixelCount({
      width: config.policy.width,
      height: config.policy.height
    });
    const dynamicAllowanceIntervalMs = calculateDynamicAllowanceIntervalMs({
      targetCompletionMs: config.projectTargetCompletionMs,
      effectiveParticipantCount: config.projectExpectedParticipants,
      requiredPixelCount
    });
    const maxSavedPixelCount = calculateMaxSavedPixelCount({
      maxStorageMs: config.pixelAllowanceMaxStorageMs,
      allowanceIntervalMs: dynamicAllowanceIntervalMs
    });

    const url = await startSocketServer();
    const client = await connectToServer(url);
    const snapshot = await waitForSnapshot(client);

    expect(snapshot.pixelAllowance).toEqual(
      expect.objectContaining({
        targetCompletionMs: config.projectTargetCompletionMs,
        requiredPixelCount,
        effectiveParticipantCount: config.projectExpectedParticipants,
        dynamicAllowanceIntervalMs,
        savedPixelCount: 1,
        maxSavedPixelCount
      })
    );
    expect(Date.parse(snapshot.pixelAllowance.nextPixelSavedAt)).not.toBeNaN();
    expect(Date.parse(snapshot.pixelAllowance.maxStorageEndsAt)).not.toBeNaN();
    expect(snapshot.nextAvailableAt).toBe(snapshot.pixelAllowance.nextPixelSavedAt);
  });

  it('sends canvasSnapshot with the persisted actor allowance after reconnect', async () => {
    const actorKey = 'act_00000000000000000000000000000a11';
    const url = await startSocketServer();
    await app!.redis.del(`pixelAllowance:${JSON.stringify([DEFAULT_CANVAS_ID, actorKey])}`);

    const firstClient = await connectToServer(url, {
      extraHeaders: {
        Cookie: cookieForActor(actorKey)
      }
    });
    const observer = await connectToServer(url);
    await Promise.all([
      waitForSnapshot(firstClient),
      waitForSnapshot(observer)
    ]);

    const firstUpdate = waitForEvent<PixelUpdatedPayload>(observer, 'pixelUpdated');
    const firstCooldown = waitForEvent<CooldownUpdatedPayload>(firstClient, 'cooldownUpdated');
    firstClient.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 91,
      y: 91,
      colorHex: '#22C55E'
    });
    await firstUpdate;
    await expect(firstCooldown).resolves.toEqual(expect.objectContaining({ savedPixelCount: 0 }));

    firstClient.disconnect();
    const reconnectedClient = await connectToServer(url, {
      extraHeaders: {
        Cookie: cookieForActor(actorKey)
      }
    });
    const snapshot = await waitForSnapshot(reconnectedClient);

    expect(snapshot.pixelAllowance).toEqual(
      expect.objectContaining({
        savedPixelCount: 0,
        maxSavedPixelCount: expect.any(Number)
      })
    );
    expect(snapshot.nextAvailableAt).toBe(snapshot.pixelAllowance.nextPixelSavedAt);
  });

  it('sends canvasSnapshot with redacted recent events for only the current actor on connection', async () => {
    const actorKey = 'act_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await upsertPixelAndLog(pool, {
      canvasId: DEFAULT_CANVAS_ID,
      x: 91,
      y: 91,
      colorHex: '#38BDF8',
      actorKey,
      actorIpHash: 'socket-test-ip-hash',
      source: 'user'
    });
    await upsertPixelAndLog(pool, {
      canvasId: DEFAULT_CANVAS_ID,
      x: 92,
      y: 91,
      colorHex: '#EF4444',
      actorKey: 'act_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      actorIpHash: 'other-socket-test-ip-hash',
      source: 'user'
    });

    const url = await startSocketServer();
    const client = await connectToServer(url, {
      extraHeaders: {
        Cookie: cookieForActor(actorKey)
      }
    });
    const snapshot = await waitForSnapshot(client);

    const event = snapshot.recentEvents.find((candidate) => candidate.x === 91 && candidate.y === 91);
    expect(event).toEqual(expect.objectContaining({ newColorHex: '#38BDF8' }));
    expect(snapshot.recentEvents).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ x: 92, y: 91, newColorHex: '#EF4444' })])
    );
    expect(event).not.toHaveProperty('actorKey');
    expect(event).not.toHaveProperty('actorIpHash');
  });

  it('updates only the placing client recent list after a valid placement', async () => {
    const url = await startSocketServer();
    const sender = await connectToServer(url);
    const observer = await connectToServer(url);
    await Promise.all([
      waitForSnapshot(sender),
      waitForSnapshot(observer)
    ]);

    const senderRecent = waitForEvent<RecentEventsUpdatedPayload>(sender, 'recentEventsUpdated');
    const observerRecent = waitForNoEvent(observer, 'recentEventsUpdated');
    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 92,
      y: 91,
      colorHex: '#ef4444'
    });

    await expect(senderRecent).resolves.toEqual({
      events: [expect.objectContaining({ x: 92, y: 91, newColorHex: '#EF4444' })]
    });
    await expect(observerRecent).resolves.toBeUndefined();
  });

  it('broadcasts pixelUpdated to another client after a valid placement', async () => {
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
      x: 92,
      y: 91,
      colorHex: '#ef4444'
    });

    await expect(pixelUpdated).resolves.toEqual(
      expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID, x: 92, y: 91, colorHex: '#EF4444' })
    );
  });

  it('broadcasts pixelUpdated to connected clients after an admin area reset', async () => {
    const url = await startSocketServer();
    const observer = await connectToServer(url);
    await expect(waitForSnapshot(observer)).resolves.toEqual(
      expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID })
    );

    const pixelUpdated = waitForEvent<PixelUpdatedPayload>(observer, 'pixelUpdated');
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
        fromX: 91,
        fromY: 91,
        toX: 92,
        toY: 91,
        colorHex: '#ffffff',
        reason: 'spam cleanup'
      }
    });

    expect(restore.statusCode).toBe(200);
    await expect(pixelUpdated).resolves.toEqual(
      expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID, x: 91, y: 91, colorHex: '#FFFFFF' })
    );
  });

  it('queues placement emitted before the initial snapshot until after snapshot delivery', async () => {
    const url = await startSocketServer({ delayCanvasSnapshotMs: 150 });
    const sender = await connectToServer(url);
    const eventOrder: string[] = [];
    const snapshot = waitForSnapshot(sender).then((payload) => {
      eventOrder.push('canvasSnapshot');
      return payload;
    });
    const pixelUpdated = waitForEvent<PixelUpdatedPayload>(sender, 'pixelUpdated').then((payload) => {
      eventOrder.push('pixelUpdated');
      return payload;
    });

    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 93,
      y: 91,
      colorHex: '#f97316'
    });

    await expect(snapshot).resolves.toEqual(expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID }));
    await expect(pixelUpdated).resolves.toEqual(
      expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID, x: 93, y: 91, colorHex: '#F97316' })
    );
    expect(eventOrder).toEqual(['canvasSnapshot', 'pixelUpdated']);
  });

  it('bounds the pre-snapshot placement queue to one payload per socket', async () => {
    const url = await startSocketServer({ delayCanvasSnapshotMs: 150 });
    const sender = await connectToServer(url);
    const rejected = waitForEvent<PlacementRejectedPayload>(sender, 'placementRejected');
    const snapshot = waitForSnapshot(sender);
    const pixelUpdated = waitForEvent<PixelUpdatedPayload>(sender, 'pixelUpdated');

    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 93,
      y: 91,
      colorHex: '#f97316'
    });
    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 94,
      y: 91,
      colorHex: '#22C55E'
    });

    await expect(rejected).resolves.toEqual(expect.objectContaining({ reason: 'server_error' }));
    await expect(snapshot).resolves.toEqual(expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID }));
    await expect(pixelUpdated).resolves.toEqual(
      expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID, x: 93, y: 91, colorHex: '#F97316' })
    );
  });

  it('processes a queued pre-snapshot placement before placements emitted after the snapshot', async () => {
    const url = await startSocketServer({ delayCanvasSnapshotMs: 50, delayFirstBlockCheckMs: 150 });
    const sender = await connectToServer(url);
    const snapshot = waitForSnapshot(sender).then((payload) => {
      sender.emit('placePixel', {
        canvasId: DEFAULT_CANVAS_ID,
        x: 94,
        y: 91,
        colorHex: '#22C55E'
      });
      return payload;
    });
    const pixelUpdated = waitForEvent<PixelUpdatedPayload>(sender, 'pixelUpdated');
    const rejected = waitForEvent<PlacementRejectedPayload>(sender, 'placementRejected');

    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 93,
      y: 91,
      colorHex: '#f97316'
    });

    await expect(snapshot).resolves.toEqual(expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID }));
    await expect(pixelUpdated).resolves.toEqual(
      expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID, x: 93, y: 91, colorHex: '#F97316' })
    );
    await expect(rejected).resolves.toEqual(expect.objectContaining({ reason: 'cooldown_active' }));
  });

  it('rejects invalid color without broadcasting pixelUpdated', async () => {
    const url = await startSocketServer();
    const sender = await connectToServer(url);
    const observer = await connectToServer(url);
    await Promise.all([
      waitForSnapshot(sender),
      waitForSnapshot(observer)
    ]);

    const rejected = waitForEvent(sender, 'placementRejected');
    const noBroadcast = waitForNoEvent(observer, 'pixelUpdated');
    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 93,
      y: 91,
      colorHex: 'not-a-color'
    });

    await expect(rejected).resolves.toEqual(expect.objectContaining({ reason: 'invalid_color' }));
    await expect(noBroadcast).resolves.toBeUndefined();
  });

  it('refunds saved allowance when the database write fails', async () => {
    const url = await startSocketServer({ failFirstPixelWrite: true });
    const sender = await connectToServer(url);
    const observer = await connectToServer(url);
    await Promise.all([
      waitForSnapshot(sender),
      waitForSnapshot(observer)
    ]);

    const rejected = waitForEvent<PlacementRejectedPayload>(sender, 'placementRejected');
    const noFailedBroadcast = waitForNoEvent(observer, 'pixelUpdated');
    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 93,
      y: 91,
      colorHex: '#22C55E'
    });

    await expect(rejected).resolves.toEqual(expect.objectContaining({ reason: 'server_error' }));
    await expect(noFailedBroadcast).resolves.toBeUndefined();

    const pixelUpdated = waitForEvent<PixelUpdatedPayload>(observer, 'pixelUpdated');
    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 93,
      y: 91,
      colorHex: '#8B5CF6'
    });

    await expect(pixelUpdated).resolves.toEqual(
      expect.objectContaining({ canvasId: DEFAULT_CANVAS_ID, x: 93, y: 91, colorHex: '#8B5CF6' })
    );
  });

  it('allows multiple placements after saved pixel actions accrue', async () => {
    config = {
      ...config,
      projectTargetCompletionMs: 100_000,
      projectExpectedParticipants: 1,
      pixelAllowanceMaxStorageMs: 50
    };
    const url = await startSocketServer();
    const sender = await connectToServer(url);
    const observer = await connectToServer(url);
    await Promise.all([
      waitForSnapshot(sender),
      waitForSnapshot(observer)
    ]);

    const firstUpdate = waitForEvent<PixelUpdatedPayload>(observer, 'pixelUpdated');
    const firstCooldown = waitForEvent<CooldownUpdatedPayload>(sender, 'cooldownUpdated');
    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 91,
      y: 91,
      colorHex: '#22C55E'
    });
    await expect(firstUpdate).resolves.toEqual(expect.objectContaining({ x: 91, y: 91, colorHex: '#22C55E' }));
    const firstCooldownPayload = await firstCooldown;
    expect(firstCooldownPayload).toEqual(
      expect.objectContaining({
        remainingMs: 0,
        savedPixelCount: 0,
        nextPixelSavedAt: expect.any(String),
        nextAvailableAt: expect.any(String)
      })
    );
    expect(firstCooldownPayload.nextAvailableAt).toBe(firstCooldownPayload.nextPixelSavedAt);

    await delay(45);

    const secondUpdate = waitForEvent<PixelUpdatedPayload>(observer, 'pixelUpdated');
    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 92,
      y: 91,
      colorHex: '#8B5CF6'
    });

    await expect(secondUpdate).resolves.toEqual(expect.objectContaining({ x: 92, y: 91, colorHex: '#8B5CF6' }));
  });

  it('rejects cooldown placement without broadcasting a second pixelUpdated', async () => {
    const url = await startSocketServer();
    const sender = await connectToServer(url);
    const observer = await connectToServer(url);
    await Promise.all([
      waitForSnapshot(sender),
      waitForSnapshot(observer)
    ]);

    const firstUpdate = waitForEvent<PixelUpdatedPayload>(observer, 'pixelUpdated');
    const firstCooldown = waitForEvent<CooldownUpdatedPayload>(sender, 'cooldownUpdated');
    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 94,
      y: 91,
      colorHex: '#22C55E'
    });
    await expect(firstUpdate).resolves.toEqual(expect.objectContaining({ x: 94, y: 91 }));
    await firstCooldown;

    const cooldownUpdated = waitForEvent<CooldownUpdatedPayload>(sender, 'cooldownUpdated');
    const rejected = waitForEvent<PlacementRejectedPayload>(sender, 'placementRejected');
    const noSecondBroadcast = waitForNoEvent(observer, 'pixelUpdated');
    sender.emit('placePixel', {
      canvasId: DEFAULT_CANVAS_ID,
      x: 95,
      y: 91,
      colorHex: '#8B5CF6'
    });

    const cooldownUpdatedPayload = await cooldownUpdated;
    expect(cooldownUpdatedPayload).toEqual(
      expect.objectContaining({
        savedPixelCount: 0,
        maxSavedPixelCount: expect.any(Number),
        remainingMs: expect.any(Number),
        nextPixelSavedAt: expect.any(String),
        nextAvailableAt: expect.any(String)
      })
    );
    expect(cooldownUpdatedPayload.nextAvailableAt).toBe(cooldownUpdatedPayload.nextPixelSavedAt);
    await expect(rejected).resolves.toEqual(
      expect.objectContaining({
        reason: 'cooldown_active',
        message: 'No saved pixels are ready yet.',
        remainingMs: expect.any(Number)
      })
    );
    await expect(noSecondBroadcast).resolves.toBeUndefined();
  });
});
