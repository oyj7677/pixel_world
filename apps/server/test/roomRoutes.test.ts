import {
  FRIEND_ROOM_CANVAS_SIZE,
  type CreateRoomInviteResponseDto,
  type QuickPixelResponseDto,
  type RoomPixelTemplateUpdatedPayload
} from '@pixel-world/shared';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { buildApp } from '../src/app';
import { ACTOR_COOKIE } from '../src/auth/actorIdentity';
import { loadConfig, type ServerConfig } from '../src/config';
import { createDbPool, type DbPool } from '../src/db/index';
import { runMigrations } from '../src/db/migrate';
import type { PixelSocketServer } from '../src/realtime/socketServer';
import { recordRoomAnalyticsEvent } from '../src/rooms/roomAnalytics';
import { createRoomWithTodayCanvas } from '../src/rooms/roomRepository';

const TEST_PREFIX = `room-routes-test-${process.pid}`;
const RAW_IP = '203.0.113.44';

let pool: DbPool;
let config: ServerConfig;
let app: Awaited<ReturnType<typeof buildApp>> | null = null;

function testConfig(): ServerConfig {
  return {
    ...config,
    webOrigin: 'https://pixel-world.test',
    cookieSecret: 'room-routes-test-cookie-secret',
  };
}

async function startApp() {
  app = await buildApp(testConfig());
  await app.ready();
  return app;
}

async function cleanupRoomRouteTestData(): Promise<void> {
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
    `DELETE FROM room_invite_uses
     WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR name LIKE $2)`,
    [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM room_pixel_allowances
     WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR name LIKE $2)`,
    [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM room_pixel_templates
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
  await pool.query(
    `DELETE FROM canvases
     WHERE id LIKE $1 OR slug LIKE $1`,
    [`room_${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM rooms
     WHERE public_id LIKE $1 OR name LIKE $2`,
    [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`],
  );
}

function actorCookieFrom(response: {
  headers: Record<string, number | string | string[] | undefined>;
}): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : typeof setCookie === 'string' ? [setCookie] : [];
  const actorCookie = cookies.find((value) =>
    value.startsWith(`${ACTOR_COOKIE}=`),
  );
  expect(actorCookie).toBeDefined();
  return actorCookie!.split(';')[0]!;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function createRoom(
  name = `${TEST_PREFIX} created room`,
  ownerDisplayName = `${TEST_PREFIX} 방장`,
  canvasDimension?: number,
) {
  const response = await app!.inject({
    method: 'POST',
    url: '/api/rooms',
    payload: { name, ownerDisplayName, ...(canvasDimension ? { canvasDimension } : {}) },
    headers: { 'x-forwarded-for': RAW_IP },
  });
  expect(response.statusCode).toBe(201);
  return { response, body: response.json(), cookie: actorCookieFrom(response) };
}

beforeAll(async () => {
  await runMigrations();
  config = loadConfig();
  pool = createDbPool(config);
});

beforeEach(async () => {
  await cleanupRoomRouteTestData();
  await startApp();
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  await cleanupRoomRouteTestData();
});

afterAll(async () => {
  await pool.end();
});

describe('room routes', () => {
  it('creates a room from a host nickname and room name and returns an invite URL', async () => {
    const { response, body } = await createRoom(
      `${TEST_PREFIX} name-only room`,
    );

    expect(response.statusCode).toBe(201);
    expect(body).toEqual({
      roomPublicId: expect.any(String),
      roomName: `${TEST_PREFIX} name-only room`,
      todayDailyCanvasId: expect.any(String),
      canvasId: expect.stringMatching(/^room_/),
      canvasSize: FRIEND_ROOM_CANVAS_SIZE,
      inviteUrl: expect.stringMatching(
        /^https:\/\/pixel-world\.test\/i\//,
      ),
      inviteCode: expect.stringMatching(/^[A-Z0-9]{4}$/),
      ownerDisplayName: `${TEST_PREFIX} 방장`,
    });
    expect(body.inviteUrl).not.toContain('undefined');
    expect(new URL(body.inviteUrl).pathname).toMatch(/^\/i\/[A-Za-z0-9_-]{16}$/);
    expect(
      response.cookies.some((cookie) => cookie.name === ACTOR_COOKIE),
    ).toBe(true);
  });

  it('creates a square room canvas with the requested dimension', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} custom size room`, `${TEST_PREFIX} 방장`, 64);

    expect(body).toEqual(expect.objectContaining({
      canvasSize: { width: 64, height: 64 },
    }));

    const landingResponse = await app!.inject({
      method: 'GET',
      url: `/api/invite-codes/${body.inviteCode}/landing`,
    });

    expect(landingResponse.statusCode).toBe(200);
    expect(landingResponse.json()).toEqual(expect.objectContaining({
      canvasSize: { width: 64, height: 64 },
      quickPixelSuggestion: { x: 32, y: 32 },
    }));
  });

  it('loads invite landing metadata with the host nickname', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} invite landing room`);
    const inviteToken = new URL(body.inviteUrl).pathname.split('/').pop();

    const response = await app!.inject({
      method: 'GET',
      url: `/api/invites/${inviteToken}/landing`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      roomPublicId: body.roomPublicId,
      roomName: `${TEST_PREFIX} invite landing room`,
      todayDailyCanvasId: body.todayDailyCanvasId,
      canvasId: body.canvasId,
      canvasSize: FRIEND_ROOM_CANVAS_SIZE,
      inviterDisplayName: `${TEST_PREFIX} 방장`,
      quickPixelSuggestion: { x: expect.any(Number), y: expect.any(Number) },
    });
  });

  it('loads invite landing metadata with a 4-character room code', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} invite code landing room`);

    const response = await app!.inject({
      method: 'GET',
      url: `/api/invite-codes/${body.inviteCode.toLowerCase()}/landing`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      roomPublicId: body.roomPublicId,
      roomName: `${TEST_PREFIX} invite code landing room`,
      todayDailyCanvasId: body.todayDailyCanvasId,
      canvasId: body.canvasId,
      canvasSize: FRIEND_ROOM_CANVAS_SIZE,
      inviterDisplayName: `${TEST_PREFIX} 방장`,
      quickPixelSuggestion: { x: expect.any(Number), y: expect.any(Number) },
    });
  });


  it('loads today room canvas metadata for the member browser session', async () => {
    const { body, cookie } = await createRoom(`${TEST_PREFIX} today room`);

    const response = await app!.inject({
      method: 'GET',
      url: `/api/rooms/${body.roomPublicId}/today`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      roomPublicId: body.roomPublicId,
      roomName: `${TEST_PREFIX} today room`,
      todayDailyCanvasId: body.todayDailyCanvasId,
      canvasId: body.canvasId,
      canvasSize: FRIEND_ROOM_CANVAS_SIZE,
      memberRole: 'owner',
    });
  });

  it('lets a room owner save and load a shared pixel template', async () => {
    const { body, cookie } = await createRoom(`${TEST_PREFIX} pixel template room`);
    const handoffs: RoomPixelTemplateUpdatedPayload[] = [];
    const handoffCanvasIds: string[] = [];
    app!.pixelSocketServer = {
      broadcastRoomPixelTemplateUpdated: (canvasId: string, payload: RoomPixelTemplateUpdatedPayload) => {
        handoffCanvasIds.push(canvasId);
        handoffs.push(payload);
      },
    } as unknown as PixelSocketServer;

    const response = await app!.inject({
      method: 'PUT',
      url: `/api/rooms/${body.roomPublicId}/pixel-template`,
      headers: { cookie },
      payload: {
        name: '테스트 로고.png',
        width: 48,
        height: 48,
        defaultColorHex: '#ffffff',
        pixels: [
          { x: 1, y: 2, colorHex: '#22c55e' },
          { x: 3, y: 4, colorHex: '#38bdf8' },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const saved = response.json();
    expect(saved).toEqual({
      template: {
        id: expect.any(String),
        roomPublicId: body.roomPublicId,
        name: '테스트 로고.png',
        width: 48,
        height: 48,
        defaultColorHex: '#FFFFFF',
        pixels: [
          { x: 1, y: 2, colorHex: '#22C55E' },
          { x: 3, y: 4, colorHex: '#38BDF8' },
        ],
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });
    expect(response.body).not.toContain('data:image');
    expect(handoffCanvasIds).toEqual([body.canvasId]);
    expect(handoffs).toEqual([
      {
        roomPublicId: body.roomPublicId,
        template: saved.template,
      },
    ]);

    const loaded = await app!.inject({
      method: 'GET',
      url: `/api/rooms/${body.roomPublicId}/pixel-template`,
      headers: { cookie },
    });

    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual(saved);
  });

  it('does not let invited guests replace the shared pixel template', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} guest pixel template room`);
    const inviteToken = new URL(body.inviteUrl).pathname.split('/').pop()!;

    const guestToday = await app!.inject({
      method: 'GET',
      url: `/api/rooms/${body.roomPublicId}/today?inviteToken=${encodeURIComponent(inviteToken)}`,
      headers: { 'x-forwarded-for': '198.51.100.94' },
    });
    expect(guestToday.statusCode).toBe(200);
    const guestCookie = actorCookieFrom(guestToday);

    const response = await app!.inject({
      method: 'PUT',
      url: `/api/rooms/${body.roomPublicId}/pixel-template`,
      headers: { cookie: guestCookie },
      payload: {
        name: '손님 샘플',
        width: 48,
        height: 48,
        defaultColorHex: '#FFFFFF',
        pixels: [{ x: 0, y: 0, colorHex: '#22C55E' }],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'room_owner_required' });
  });

  it('opens an older invite by creating today’s room canvas before the invite recipient joins', async () => {
    const created = await createRoomWithTodayCanvas(pool, {
      name: `${TEST_PREFIX} older invite room`,
      ownerActorKey: `${TEST_PREFIX}-older-invite-owner`,
      ownerDisplayName: `${TEST_PREFIX} 오래된 방장`,
      publicIdPrefix: TEST_PREFIX,
      inviteSecret: testConfig().cookieSecret,
      today: new Date('2026-05-17T03:30:00.000Z'),
    });

    const landingResponse = await app!.inject({
      method: 'GET',
      url: `/api/invites/${created.invite.rawToken}/landing`,
      headers: { 'x-forwarded-for': RAW_IP },
    });

    expect(landingResponse.statusCode).toBe(200);
    const landingBody = landingResponse.json();
    expect(landingBody.roomPublicId).toBe(created.room.publicId);
    expect(landingBody.todayDailyCanvasId).not.toBe(created.dailyCanvas.id);

    const recipientCookie = actorCookieFrom(landingResponse);
    const joinResponse = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${created.room.publicId}/quick-pixel`,
      headers: {
        cookie: recipientCookie,
        'x-forwarded-for': RAW_IP,
      },
      payload: {
        inviteToken: created.invite.rawToken,
        displayName: `${TEST_PREFIX} 초대 직원`,
      },
    });

    expect(joinResponse.statusCode).toBe(201);

    const todayResponse = await app!.inject({
      method: 'GET',
      url: `/api/rooms/${created.room.publicId}/today`,
      headers: { cookie: recipientCookie },
    });

    expect(todayResponse.statusCode).toBe(200);
    expect(todayResponse.json()).toEqual({
      roomPublicId: created.room.publicId,
      roomName: `${TEST_PREFIX} older invite room`,
      todayDailyCanvasId: landingBody.todayDailyCanvasId,
      canvasId: landingBody.canvasId,
      canvasSize: FRIEND_ROOM_CANVAS_SIZE,
      memberRole: 'guest',
    });
  });

  it('lets a room member create a fresh invite URL from the room page', async () => {
    const { body, cookie } = await createRoom(`${TEST_PREFIX} room-page invite room`);

    const response = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/invites`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const inviteBody = response.json<CreateRoomInviteResponseDto>();
    expect(inviteBody).toEqual({
      roomPublicId: body.roomPublicId,
      inviteUrl: expect.stringMatching(/^https:\/\/pixel-world\.test\/i\//),
      inviteCode: expect.stringMatching(/^[A-Z0-9]{4}$/),
    });
    expect(inviteBody.inviteUrl).not.toEqual(body.inviteUrl);
  });

  it('does not create room-page invite URLs for non-members', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} non-member invite room`);

    const response = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/invites`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'room_membership_required' });
  });

  it('opens the room with an invite token when the browser does not retain the API cookie', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} mobile cookie blocked room`);
    const inviteToken = new URL(body.inviteUrl).pathname.split('/').pop()!;

    const quickPixel = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/quick-pixel`,
      payload: { inviteToken, suggestedColorHex: '#22c55e', displayName: '모바일직원' },
      headers: { 'x-forwarded-for': '198.51.100.88' },
    });
    expect(quickPixel.statusCode).toBe(201);

    const withoutInviteToken = await app!.inject({
      method: 'GET',
      url: `/api/rooms/${body.roomPublicId}/today`,
      headers: { 'x-forwarded-for': '198.51.100.88' },
    });
    expect(withoutInviteToken.statusCode).toBe(404);

    const withInviteToken = await app!.inject({
      method: 'GET',
      url: `/api/rooms/${body.roomPublicId}/today?inviteToken=${encodeURIComponent(inviteToken)}`,
      headers: { 'x-forwarded-for': '198.51.100.88' },
    });
    expect(withInviteToken.statusCode).toBe(200);
    expect(withInviteToken.json()).toEqual({
      roomPublicId: body.roomPublicId,
      roomName: `${TEST_PREFIX} mobile cookie blocked room`,
      todayDailyCanvasId: body.todayDailyCanvasId,
      canvasId: body.canvasId,
      canvasSize: FRIEND_ROOM_CANVAS_SIZE,
      memberRole: 'guest',
    });

    const withInviteCode = await app!.inject({
      method: 'GET',
      url: `/api/rooms/${body.roomPublicId}/today?inviteCode=${body.inviteCode.toLowerCase()}`,
      headers: { 'x-forwarded-for': '198.51.100.89' },
    });
    expect(withInviteCode.statusCode).toBe(200);
    expect(withInviteCode.json()).toEqual({
      roomPublicId: body.roomPublicId,
      roomName: `${TEST_PREFIX} mobile cookie blocked room`,
      todayDailyCanvasId: body.todayDailyCanvasId,
      canvasId: body.canvasId,
      canvasSize: FRIEND_ROOM_CANVAS_SIZE,
      memberRole: 'guest',
    });

    const freshInvite = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/invites?inviteToken=${encodeURIComponent(inviteToken)}`,
      headers: { 'x-forwarded-for': '198.51.100.88' },
    });
    expect(freshInvite.statusCode).toBe(201);
    expect(freshInvite.json<CreateRoomInviteResponseDto>()).toEqual({
      roomPublicId: body.roomPublicId,
      inviteUrl: expect.stringMatching(/^https:\/\/pixel-world\.test\/i\//),
      inviteCode: expect.stringMatching(/^[A-Z0-9]{4}$/),
    });
  });

  it('lets invitees place a Quick Pixel with a 4-character room code', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} quick pixel code room`);

    const response = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/quick-pixel`,
      payload: { inviteCode: body.inviteCode.toLowerCase(), suggestedColorHex: '#22c55e', displayName: '코드손님' },
      headers: { 'x-forwarded-for': '198.51.100.90' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<QuickPixelResponseDto>()).toEqual(expect.objectContaining({
      accepted: true,
      roomPublicId: body.roomPublicId,
      canvasId: body.canvasId,
      colorHex: '#22C55E',
    }));
  });

  it('rate-limits repeated invalid invite code landing attempts', async () => {
    const rateLimitIp = `2001:db8::${(process.pid % 65535).toString(16)}`;

    let response = await app!.inject({
      method: 'GET',
      url: '/api/invite-codes/ZZZZ/landing',
      headers: { 'x-forwarded-for': rateLimitIp },
    });

    expect(response.statusCode).toBe(404);

    for (let index = 1; index < 30; index += 1) {
      response = await app!.inject({
        method: 'GET',
        url: '/api/invite-codes/ZZZZ/landing',
        headers: { 'x-forwarded-for': rateLimitIp },
      });
      expect(response.statusCode).toBe(404);
    }

    response = await app!.inject({
      method: 'GET',
      url: '/api/invite-codes/ZZZZ/landing',
      headers: { 'x-forwarded-for': rateLimitIp },
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: 'invite_code_rate_limited' });
  });

  it('rejects invalid invite tokens without leaking private room details', async () => {
    await createRoom(`${TEST_PREFIX} private invalid invite room`);

    const response = await app!.inject({
      method: 'GET',
      url: '/api/invites/not-a-real-token/landing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'invalid_invite' });
    expect(response.body).not.toContain(TEST_PREFIX);
    expect(response.body).not.toContain('room_');
    expect(response.body).not.toContain('private');
  });


  it('requires a nickname before a first invited Quick Pixel when no same-IP nickname exists', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} quick pixel nickname required room`);
    const inviteToken = new URL(body.inviteUrl).pathname.split('/').pop()!;

    const response = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/quick-pixel`,
      payload: { inviteToken, suggestedColorHex: '#22c55e' },
      headers: { 'x-forwarded-for': '198.51.100.20' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(expect.objectContaining({ error: 'display_name_required' }));
  });

  it('suggests a same-IP nickname but still requires explicit confirmation for a different browser', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} invite ip nickname suggestion room`);
    const inviteToken = new URL(body.inviteUrl).pathname.split('/').pop()!;
    const inviteeIp = '198.51.100.77';

    const first = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/quick-pixel`,
      payload: { inviteToken, suggestedColorHex: '#22c55e', displayName: '준호' },
      headers: { 'x-forwarded-for': inviteeIp },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json<QuickPixelResponseDto>()).toEqual(expect.objectContaining({ optionalNamePrompt: false }));

    const landing = await app!.inject({
      method: 'GET',
      url: `/api/invites/${inviteToken}/landing`,
      headers: { 'x-forwarded-for': inviteeIp },
    });
    expect(landing.statusCode).toBe(200);
    expect(landing.json()).toEqual(expect.objectContaining({ suggestedParticipantDisplayName: '준호' }));
    expect(landing.json()).not.toHaveProperty('participantDisplayName');

    const second = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/quick-pixel`,
      payload: { inviteToken, suggestedColorHex: '#38bdf8' },
      headers: { 'x-forwarded-for': inviteeIp },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json()).toEqual(expect.objectContaining({ error: 'display_name_required' }));

    const confirmed = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/quick-pixel`,
      payload: { inviteToken, suggestedColorHex: '#38bdf8', displayName: '준호' },
      headers: { 'x-forwarded-for': inviteeIp },
    });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json<QuickPixelResponseDto>()).toEqual(expect.objectContaining({ optionalNamePrompt: false }));

    const memberRows = await pool.query<{ display_name: string | null }>(
      `SELECT display_name
       FROM room_members
       WHERE room_id = (SELECT id FROM rooms WHERE public_id = $1)
         AND role = 'guest'
       ORDER BY joined_at ASC`,
      [body.roomPublicId],
    );
    expect(memberRows.rows.map((row) => row.display_name)).toContain('준호');
    expect(memberRows.rows.every((row) => row.display_name === '준호')).toBe(true);
  });

  it('hands off successful Quick Pixel payload to realtime after persistence', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} quick pixel handoff room`);
    const inviteToken = new URL(body.inviteUrl).pathname.split('/').pop()!;
    const handoffs: QuickPixelResponseDto[] = [];
    app!.pixelSocketServer = {
      broadcastQuickPixelPlaced: async (payload: QuickPixelResponseDto) => {
        handoffs.push(payload);
      },
    } as unknown as PixelSocketServer;

    const response = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/quick-pixel`,
      payload: { inviteToken, suggestedColorHex: '#22c55e', displayName: '초대 손님' },
      headers: { 'x-forwarded-for': RAW_IP },
    });

    expect(response.statusCode).toBe(201);
    const quickPixel = response.json<QuickPixelResponseDto>();
    expect(quickPixel).toEqual(expect.objectContaining({
      accepted: true,
      roomPublicId: body.roomPublicId,
      canvasId: body.canvasId,
      colorHex: '#22C55E',
    }));
    expect(handoffs).toEqual([quickPixel]);

    const savedPixel = await pool.query(
      'SELECT 1 FROM pixels WHERE canvas_id = $1 AND x = $2 AND y = $3',
      [quickPixel.canvasId, quickPixel.x, quickPixel.y],
    );
    expect(savedPixel.rowCount).toBe(1);
  });


  it('does not wait for slow Quick Pixel realtime handoff before responding', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} quick pixel slow handoff room`);
    const inviteToken = new URL(body.inviteUrl).pathname.split('/').pop()!;
    let releaseHandoff!: () => void;
    const handoffStarted = new Promise<void>((resolve) => {
      app!.pixelSocketServer = {
        broadcastQuickPixelPlaced: () => {
          resolve();
          return new Promise<void>((handoffResolve) => {
            releaseHandoff = handoffResolve;
          });
        },
      } as unknown as PixelSocketServer;
    });

    const responsePromise = app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/quick-pixel`,
      payload: { inviteToken, suggestedColorHex: '#22c55e', displayName: '초대 손님' },
      headers: { 'x-forwarded-for': RAW_IP },
    });

    await handoffStarted;
    const earlyResult = await Promise.race([
      responsePromise.then((response) => response.statusCode),
      delay(25).then(() => 'blocked'),
    ]);
    releaseHandoff();

    expect(earlyResult).toBe(201);
    await expect(responsePromise).resolves.toMatchObject({ statusCode: 201 });
  });

  it('logs rejected Quick Pixel realtime handoff without failing the response', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} quick pixel rejected async handoff room`);
    const inviteToken = new URL(body.inviteUrl).pathname.split('/').pop()!;
    app!.pixelSocketServer = {
      broadcastQuickPixelPlaced: () => Promise.reject(new Error('handoff failed in test')),
    } as unknown as PixelSocketServer;

    const response = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/quick-pixel`,
      payload: { inviteToken, suggestedColorHex: '#22c55e', displayName: '초대 손님' },
      headers: { 'x-forwarded-for': RAW_IP },
    });

    expect(response.statusCode).toBe(201);
  });

  it('does not hand off Quick Pixel payload when placement is rejected', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} quick pixel rejected handoff room`);
    const handoffs: QuickPixelResponseDto[] = [];
    app!.pixelSocketServer = {
      broadcastQuickPixelPlaced: async (payload: QuickPixelResponseDto) => {
        handoffs.push(payload);
      },
    } as unknown as PixelSocketServer;

    const response = await app!.inject({
      method: 'POST',
      url: `/api/rooms/${body.roomPublicId}/quick-pixel`,
      payload: { inviteToken: 'not-a-real-invite' },
      headers: { 'x-forwarded-for': RAW_IP },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(expect.objectContaining({ error: 'invalid_invite' }));
    expect(handoffs).toEqual([]);
  });

  it('sets optional display name only after membership exists', async () => {
    const { body, cookie } = await createRoom(
      `${TEST_PREFIX} display name room`,
    );

    const stranger = await app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${body.roomPublicId}/me`,
      payload: { displayName: 'Mina' },
    });
    expect(stranger.statusCode).toBe(404);
    expect(stranger.json()).toEqual({ error: 'room_membership_required' });

    const named = await app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${body.roomPublicId}/me`,
      headers: { cookie },
      payload: { displayName: 'Mina' },
    });
    expect(named.statusCode).toBe(200);
    expect(named.json()).toEqual({
      roomPublicId: body.roomPublicId,
      displayName: 'Mina',
    });

    const skipped = await app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${body.roomPublicId}/me`,
      headers: { cookie },
      payload: { displayName: '' },
    });
    expect(skipped.statusCode).toBe(200);
    expect(skipped.json()).toEqual({
      roomPublicId: body.roomPublicId,
      displayName: null,
    });
  });

  it('sanitizes unsafe analytics property values at the room analytics boundary', async () => {
    const { body } = await createRoom(
      `${TEST_PREFIX} unsafe analytics boundary room`,
    );
    const room = await pool.query<{ id: string }>(
      'SELECT id FROM rooms WHERE public_id = $1',
      [body.roomPublicId],
    );
    const roomId = room.rows[0]!.id;
    const inviteToken = new URL(body.inviteUrl).pathname.split('/').pop()!;

    await recordRoomAnalyticsEvent(pool, {
      name: 'invite_link_created',
      roomId,
      roomPublicId: body.roomPublicId,
      properties: {
        inviteRoute: '/i/:token',
        source: RAW_IP,
        value: body.inviteUrl,
        label: inviteToken,
        messagePreview: 'hello from private chat',
        actorExport: 'act_0123456789abcdef0123456789abcdef',
      },
    });

    const event = await pool.query<{ properties: Record<string, unknown> }>(
      `SELECT properties
       FROM analytics_events
       WHERE room_public_id = $1
         AND name = 'invite_link_created'
       ORDER BY occurred_at DESC
       LIMIT 1`,
      [body.roomPublicId],
    );

    expect(event.rows[0]!.properties).toEqual({
      inviteRoute: '/i/:token',
    });
    const serializedProperties = JSON.stringify(event.rows[0]!.properties);
    expect(serializedProperties).not.toContain(RAW_IP);
    expect(serializedProperties).not.toContain(body.inviteUrl);
    expect(serializedProperties).not.toContain(inviteToken);
    expect(serializedProperties).not.toContain('hello from private chat');
    expect(serializedProperties).not.toContain(
      'act_0123456789abcdef0123456789abcdef',
    );
  });

  it('records privacy-safe analytics events without raw IP or full invite URL', async () => {
    const { body } = await createRoom(`${TEST_PREFIX} analytics room`);

    const events = await pool.query<{
      name: string;
      properties: Record<string, unknown>;
    }>(
      `SELECT name, properties
       FROM analytics_events
       WHERE room_public_id = $1
       ORDER BY occurred_at ASC`,
      [body.roomPublicId],
    );

    expect(events.rows.map((event) => event.name)).toEqual([
      'room_created',
      'invite_link_created',
    ]);
    const serializedProperties = JSON.stringify(
      events.rows.map((event) => event.properties),
    );
    expect(serializedProperties).not.toContain(RAW_IP);
    expect(serializedProperties).not.toContain(body.inviteUrl);
    expect(serializedProperties).not.toContain(
      new URL(body.inviteUrl).pathname.split('/').pop()!,
    );
    const firstEvent = events.rows[0];
    const secondEvent = events.rows[1];
    expect(firstEvent).toBeDefined();
    expect(secondEvent).toBeDefined();
    expect(firstEvent!.properties).toEqual(
      expect.objectContaining({
        canvasSize: `${FRIEND_ROOM_CANVAS_SIZE.width}x${FRIEND_ROOM_CANVAS_SIZE.height}`,
      }),
    );
    expect(secondEvent!.properties).toEqual(expect.objectContaining({ inviteRoute: '/i/:token' }));
  });
});
