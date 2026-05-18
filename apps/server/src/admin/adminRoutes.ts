import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DEFAULT_CANVAS_ID,
  normalizeHexColor,
  validateCoordinate,
  type HexColor,
  type PixelUpdatedPayload
} from '@pixel-world/shared';
import {
  ADMIN_COOKIE,
  createAdminSessionToken,
  isCorrectAdminPassword,
  verifyAdminSessionToken
} from '../auth/adminSession';
import { isValidActorKey } from '../auth/actorIdentity';
import {
  createBlock,
  getRecentEvents,
  logAdminAction,
  upsertPixelAndLog,
  type LoggedPixelEvent
} from '../db/canvasRepository';

export const ADMIN_SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;
export const MAX_RESTORE_AREA_PIXELS = 1000;
export const MAX_BLOCK_DURATION_MINUTES = 60 * 24 * 30;
const MAX_MODERATION_REASON_LENGTH = 160;
const ACTOR_IP_HASH_PATTERN = /^[a-fA-F0-9]{64}$/;

interface LoginBody {
  password?: string;
}

interface RestorePixelBody extends ScopedModerationBody {
  x?: number | undefined;
  y?: number | undefined;
  colorHex?: string | undefined;
}

interface ScopedModerationBody {
  scopeType?: 'global' | 'room' | 'daily_canvas' | 'canvas' | undefined;
  roomPublicId?: string | undefined;
  roomId?: string | undefined;
  dailyCanvasId?: string | undefined;
  canvasId?: string | undefined;
}

interface RestoreAreaBody extends ScopedModerationBody {
  fromX?: number | undefined;
  fromY?: number | undefined;
  toX?: number | undefined;
  toY?: number | undefined;
  colorHex?: string | undefined;
  reason?: string | undefined;
}

interface BlockBody extends ScopedModerationBody {
  actorKey?: string | undefined;
  actorIpHash?: string | undefined;
  reason?: string | undefined;
  durationMinutes?: number | undefined;
}

export function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  secret: string
): boolean {
  const token = request.cookies[ADMIN_COOKIE];
  if (verifyAdminSessionToken(token, secret, ADMIN_SESSION_MAX_AGE_MS)) {
    return true;
  }

  reply.code(401).send({ error: 'admin_session_required' });
  return false;
}

function parseRestorePixelRequest(
  policy: FastifyInstance['config']['policy'],
  body: RestorePixelBody
): { x: number; y: number; colorHex: HexColor } | null {
  if (typeof body.x !== 'number' || typeof body.y !== 'number' || typeof body.colorHex !== 'string') {
    return null;
  }

  const coordinate = validateCoordinate(policy, body.x, body.y);
  const colorHex = normalizeHexColor(body.colorHex);
  if (!coordinate.ok || !colorHex) {
    return null;
  }

  return { x: body.x, y: body.y, colorHex };
}

function hasDefinedProperty<T extends object>(value: T, key: keyof T): boolean {
  return Object.hasOwn(value, key) && value[key] !== undefined;
}

function parseModerationReason(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const reason = value.trim();
  if (!reason || reason.length > MAX_MODERATION_REASON_LENGTH) {
    return null;
  }

  return reason;
}

function parseBlockRequest(body: BlockBody):
  | { actorKey?: string; actorIpHash?: string; reason: string; durationMinutes: number }
  | null {
  let actorKey: string | undefined;
  let actorIpHash: string | undefined;

  if (hasDefinedProperty(body, 'actorKey')) {
    if (typeof body.actorKey !== 'string') {
      return null;
    }

    const candidate = body.actorKey.trim();
    if (!isValidActorKey(candidate)) {
      return null;
    }

    actorKey = candidate;
  }

  if (hasDefinedProperty(body, 'actorIpHash')) {
    if (typeof body.actorIpHash !== 'string') {
      return null;
    }

    const candidate = body.actorIpHash.trim();
    if (!ACTOR_IP_HASH_PATTERN.test(candidate)) {
      return null;
    }

    actorIpHash = candidate.toLowerCase();
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const durationMinutes = body.durationMinutes;

  if (
    (!actorKey && !actorIpHash) ||
    !reason ||
    typeof durationMinutes !== 'number' ||
    !Number.isFinite(durationMinutes) ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    durationMinutes > MAX_BLOCK_DURATION_MINUTES
  ) {
    return null;
  }

  return {
    ...(actorKey ? { actorKey } : {}),
    ...(actorIpHash ? { actorIpHash } : {}),
    reason,
    durationMinutes
  };
}

interface ModerationScope {
  scopeType: 'global' | 'room' | 'daily_canvas' | 'canvas';
  roomPublicId: string | null;
  roomId: string | null;
  dailyCanvasId: string | null;
  canvasId: string;
  width: number;
  height: number;
}


const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

function nonBlankString(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validOptionalUuid(value: string | null): boolean {
  return value === null || UUID_PATTERN.test(value);
}

async function resolveModerationScope(
  app: FastifyInstance,
  body: ScopedModerationBody
): Promise<ModerationScope | null> {
  if (!body.scopeType || body.scopeType === 'global') {
    return {
      scopeType: 'global',
      roomPublicId: null,
      roomId: null,
      dailyCanvasId: null,
      canvasId: DEFAULT_CANVAS_ID,
      width: app.config.policy.width,
      height: app.config.policy.height
    };
  }

  if (!['room', 'daily_canvas', 'canvas'].includes(body.scopeType)) {
    return null;
  }

  const roomPublicId = nonBlankString(body.roomPublicId);
  const roomId = nonBlankString(body.roomId);
  const dailyCanvasId = nonBlankString(body.dailyCanvasId);
  const canvasId = nonBlankString(body.canvasId);

  if (!validOptionalUuid(roomId) || !validOptionalUuid(dailyCanvasId)) {
    return null;
  }

  if (body.scopeType === 'room' && !roomPublicId && !roomId) {
    return null;
  }
  if (body.scopeType === 'daily_canvas' && !dailyCanvasId) {
    return null;
  }
  if (body.scopeType === 'canvas' && !canvasId && !dailyCanvasId) {
    return null;
  }

  const result = await app.db.query<{
    room_public_id: string;
    room_id: string;
    daily_canvas_id: string;
    canvas_id: string;
    width: number;
    height: number;
  }>(
    `SELECT r.public_id AS room_public_id, r.id AS room_id, dc.id AS daily_canvas_id, dc.canvas_id, dc.width, dc.height
     FROM rooms r
     JOIN daily_canvases dc ON dc.room_id = r.id
     WHERE ($1::text IS NULL OR r.public_id = $1)
       AND ($2::uuid IS NULL OR r.id = $2::uuid)
       AND ($3::uuid IS NULL OR dc.id = $3::uuid)
       AND ($4::text IS NULL OR dc.canvas_id = $4)
       AND r.archived_at IS NULL
     ORDER BY dc.canvas_date DESC
     LIMIT 1`,
    [roomPublicId, roomId, dailyCanvasId, canvasId]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    scopeType: body.scopeType,
    roomPublicId: row.room_public_id,
    roomId: row.room_id,
    dailyCanvasId: row.daily_canvas_id,
    canvasId: row.canvas_id,
    width: Number(row.width),
    height: Number(row.height)
  };
}

function isInScopeBounds(scope: ModerationScope, x: number, y: number): boolean {
  return x >= 0 && x < scope.width && y >= 0 && y < scope.height;
}

async function restorePixel(
  app: FastifyInstance,
  input: { x: number; y: number; colorHex: HexColor; canvasId?: string }
): Promise<LoggedPixelEvent> {
  return upsertPixelAndLog(app.db, {
    canvasId: input.canvasId ?? DEFAULT_CANVAS_ID,
    x: input.x,
    y: input.y,
    colorHex: input.colorHex,
    actorKey: 'admin',
    actorIpHash: 'admin',
    source: 'admin'
  });
}

function emitPixelUpdates(
  app: FastifyInstance,
  events: LoggedPixelEvent[],
  scope?: Pick<ModerationScope, 'roomPublicId' | 'roomId' | 'dailyCanvasId'>
): void {
  const io = app.pixelSocketServer;
  if (!io) {
    return;
  }

  for (const event of events) {
    const payload: PixelUpdatedPayload = {
      ...(scope?.roomPublicId && scope.dailyCanvasId
        ? { roomPublicId: scope.roomPublicId, dailyCanvasId: scope.dailyCanvasId }
        : {}),
      canvasId: event.canvasId ?? DEFAULT_CANVAS_ID,
      x: event.x,
      y: event.y,
      colorHex: event.newColorHex,
      updatedAt: event.createdAt
    };
    io.broadcastPixelUpdated?.(payload);
  }
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LoginBody }>('/admin/login', async (request, reply) => {
    const password = request.body?.password;
    if (typeof password !== 'string' || !isCorrectAdminPassword(password, app.config.adminPassword)) {
      return reply.code(401).send({ error: 'invalid_admin_password' });
    }

    reply.setCookie(ADMIN_COOKIE, createAdminSessionToken(app.config.cookieSecret), {
      httpOnly: true,
      sameSite: app.config.cookieSameSite,
      path: '/',
      maxAge: Math.floor(ADMIN_SESSION_MAX_AGE_MS / 1000),
      secure: app.config.secureCookies
    });

    return { ok: true };
  });

  app.get('/admin/events', async (request, reply) => {
    if (!requireAdmin(request, reply, app.config.cookieSecret)) {
      return reply;
    }

    return { events: await getRecentEvents(app.db, DEFAULT_CANVAS_ID, 100) };
  });

  app.post<{ Body: RestorePixelBody }>('/admin/restore/pixel', async (request, reply) => {
    if (!requireAdmin(request, reply, app.config.cookieSecret)) {
      return reply;
    }

    const parsed = parseRestorePixelRequest(app.config.policy, request.body ?? {});
    if (!parsed) {
      return reply.code(400).send({ error: 'invalid_restore_request' });
    }

    const scope = await resolveModerationScope(app, request.body ?? {});
    if (!scope) {
      return reply.code(400).send({ error: 'invalid_scope' });
    }

    if (!isInScopeBounds(scope, parsed.x, parsed.y)) {
      return reply.code(400).send({ error: 'invalid_restore_request' });
    }

    const event = await restorePixel(app, { ...parsed, canvasId: scope.canvasId });
    await logAdminAction(
      app.db,
      'restore_pixel',
      `${parsed.x},${parsed.y}`,
      { colorHex: parsed.colorHex },
      scope
    );
    emitPixelUpdates(app, [event], scope);

    return { event };
  });

  app.post<{ Body: RestoreAreaBody }>('/admin/restore/area', async (request, reply) => {
    if (!requireAdmin(request, reply, app.config.cookieSecret)) {
      return reply;
    }

    const body = request.body ?? {};
    const scope = await resolveModerationScope(app, body);
    if (!scope) {
      return reply.code(400).send({ error: 'invalid_scope' });
    }

    const from = parseRestorePixelRequest(app.config.policy, {
      x: body.fromX,
      y: body.fromY,
      colorHex: body.colorHex
    });
    const to = parseRestorePixelRequest(app.config.policy, {
      x: body.toX,
      y: body.toY,
      colorHex: body.colorHex
    });
    if (!from || !to || !isInScopeBounds(scope, from.x, from.y) || !isInScopeBounds(scope, to.x, to.y)) {
      return reply.code(400).send({ error: 'invalid_restore_request' });
    }
    const reason = parseModerationReason(body.reason);
    if (!reason) {
      return reply.code(400).send({ error: 'invalid_restore_request' });
    }

    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);
    const count = (maxX - minX + 1) * (maxY - minY + 1);
    if (count > MAX_RESTORE_AREA_PIXELS) {
      return reply.code(400).send({ error: 'restore_area_too_large' });
    }

    const events: LoggedPixelEvent[] = [];

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        events.push(await restorePixel(app, { x, y, colorHex: from.colorHex, canvasId: scope.canvasId }));
      }
    }

    await logAdminAction(
      app.db,
      'restore_area',
      `${minX},${minY}-${maxX},${maxY}`,
      { colorHex: from.colorHex, count, reason },
      scope
    );
    emitPixelUpdates(app, events, scope);

    return { events };
  });

  app.post<{ Body: BlockBody }>('/admin/blocks', async (request, reply) => {
    if (!requireAdmin(request, reply, app.config.cookieSecret)) {
      return reply;
    }

    const parsed = parseBlockRequest(request.body ?? {});
    if (!parsed) {
      return reply.code(400).send({ error: 'invalid_block_request' });
    }

    const expiresAt = new Date(Date.now() + parsed.durationMinutes * 60 * 1000);
    if (!Number.isFinite(expiresAt.getTime())) {
      return reply.code(400).send({ error: 'invalid_block_request' });
    }

    const scope = await resolveModerationScope(app, request.body ?? {});
    if (!scope) {
      return reply.code(400).send({ error: 'invalid_scope' });
    }

    await createBlock(app.db, {
      ...(parsed.actorKey ? { actorKey: parsed.actorKey } : {}),
      ...(parsed.actorIpHash ? { actorIpHash: parsed.actorIpHash } : {}),
      reason: parsed.reason,
      expiresAt,
      scopeType: scope.scopeType,
      roomId: scope.roomId,
      dailyCanvasId: scope.dailyCanvasId,
      canvasId: scope.canvasId
    });
    await logAdminAction(
      app.db,
      'block_actor',
      parsed.actorKey ?? parsed.actorIpHash!,
      { reason: parsed.reason, expiresAt: expiresAt.toISOString() },
      scope
    );

    return { ok: true, expiresAt: expiresAt.toISOString() };
  });

  app.post<{ Params: { roomPublicId: string }; Body: { reason?: string } }>(
    '/admin/rooms/:roomPublicId/archive',
    async (request, reply) => {
      if (!requireAdmin(request, reply, app.config.cookieSecret)) {
        return reply;
      }

      const reason = parseModerationReason(request.body?.reason);
      if (!reason) {
        return reply.code(400).send({ error: 'invalid_archive_request' });
      }

      const scope = await resolveModerationScope(app, {
        scopeType: 'room',
        roomPublicId: request.params.roomPublicId
      });
      if (!scope || !scope.roomId) {
        return reply.code(404).send({ error: 'room_not_found' });
      }

      await app.db.query('UPDATE rooms SET archived_at = COALESCE(archived_at, now()) WHERE id = $1', [scope.roomId]);
      await logAdminAction(app.db, 'archive_room', request.params.roomPublicId, { reason }, {
        ...scope,
        scopeType: 'room'
      });

      return { ok: true };
    }
  );
}
