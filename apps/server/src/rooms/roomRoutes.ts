import {
  FRIEND_ROOM_DEFAULT_CANVAS_DIMENSION,
  FRIEND_ROOM_MAX_CANVAS_DIMENSION,
  FRIEND_ROOM_MIN_CANVAS_DIMENSION,
  FRIEND_ROOM_ROUTES,
  ROOM_PIXEL_TEMPLATE_MAX_NAME_LENGTH,
  type CreateRoomInviteResponseDto,
  type CreateRoomRequestDto,
  type CreateRoomResponseDto,
  type HexColor,
  type InviteLandingResponseDto,
  type OptionalDisplayNameRequestDto,
  type OptionalDisplayNameResponseDto,
  type QuickPixelRequestDto,
  type RoomPixelTemplateDto,
  type RoomPixelTemplatePixelDto,
  type RoomPixelTemplateResponseDto,
  type SaveRoomPixelTemplateRequestDto,
  type SaveRoomPixelTemplateResponseDto,
  isValidRoomCanvasDimension,
  isValidRoomDisplayName,
  isValidRoomName,
  normalizeHexColor,
  normalizeInviteCode,
} from '@pixel-world/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getOrSetActorKey, getRequestIp, hashIpAddress } from '../auth/actorIdentity';
import {
  createInvite,
  createRoomWithTodayCanvas,
  ensureRoomToday,
  ensureRoomTodayById,
  ensureRoomMember,
  getActiveRoomMember,
  getRecentInviteMemberByIpHash,
  getRoomPixelTemplate,
  replaceRoomPixelTemplate,
  updateRoomMemberDisplayName,
  validateInvite,
  validateInviteByCode,
  type InviteRecord,
  type RoomPixelTemplateRecord,
} from './roomRepository';
import { RedisPixelAllowanceStore } from '../services/pixelAllowanceService';
import { placeQuickPixel, QuickPixelRejectedError } from './quickPixelService';
import { recordRoomAnalyticsEvent } from './roomAnalytics';

const MAX_DISPLAY_NAME_LENGTH = 40;
const INVITE_ROUTE_TEMPLATE = '/i/:token';
const INVITE_CODE_LANDING_ATTEMPT_LIMIT = 30;
const INVITE_CODE_LANDING_WINDOW_MS = 5 * 60 * 1000;
const ROOM_PIXEL_TEMPLATE_DEFAULT_NAME = '공유 샘플';

function inviteSecret(app: FastifyInstance): string {
  return app.config.cookieSecret;
}

function getOrSetRoomActorKey(app: FastifyInstance, request: Parameters<typeof getOrSetActorKey>[0], reply: FastifyReply): string {
  return getOrSetActorKey(request, reply, {
    secureCookie: app.config.secureCookies,
    sameSite: app.config.cookieSameSite,
  });
}

function sendInvalidInvite(reply: FastifyReply) {
  return reply.code(404).send({ error: 'invalid_invite' });
}

function sendInviteCodeRateLimit(reply: FastifyReply) {
  return reply.code(429).send({ error: 'invite_code_rate_limited' });
}

function buildInviteUrl(webOrigin: string, rawInviteToken: string): string {
  return new URL(
    FRIEND_ROOM_ROUTES.invite(rawInviteToken),
    webOrigin,
  ).toString();
}

function parseCreateRoomBody(body: unknown): CreateRoomRequestDto | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const name = (body as { name?: unknown }).name;
  const ownerDisplayName = (body as { ownerDisplayName?: unknown }).ownerDisplayName;
  const canvasDimension = (body as { canvasDimension?: unknown }).canvasDimension;
  if (typeof name !== 'string' || !isValidRoomName(name)) {
    return null;
  }
  if (typeof ownerDisplayName !== 'string' || !isValidRoomDisplayName(ownerDisplayName)) {
    return null;
  }
  if (canvasDimension !== undefined && (typeof canvasDimension !== 'number' || !isValidRoomCanvasDimension(canvasDimension))) {
    return null;
  }

  return {
    name: name.trim(),
    ownerDisplayName: ownerDisplayName.trim(),
    canvasDimension: canvasDimension ?? FRIEND_ROOM_DEFAULT_CANVAS_DIMENSION,
  };
}

function parseOptionalDisplayNameBody(
  body: unknown,
): string | null | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const displayName = (body as OptionalDisplayNameRequestDto).displayName;
  if (displayName === undefined || typeof displayName !== 'string') {
    return undefined;
  }

  const trimmed = displayName.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return undefined;
  }

  return trimmed;
}

function parseQuickPixelBody(body: unknown): QuickPixelRequestDto | null {
  if (!body || typeof body !== 'object') {
    return {};
  }

  const payload = body as QuickPixelRequestDto;
  if (payload.inviteToken !== undefined && typeof payload.inviteToken !== 'string') {
    return null;
  }
  if (payload.inviteCode !== undefined && typeof payload.inviteCode !== 'string') {
    return null;
  }
  if (payload.suggestedColorHex !== undefined && typeof payload.suggestedColorHex !== 'string') {
    return null;
  }
  if (payload.suggestedCoordinate !== undefined) {
    const coordinate = payload.suggestedCoordinate;
    if (
      typeof coordinate !== 'object' ||
      coordinate === null ||
      !Number.isInteger((coordinate as { x?: unknown }).x) ||
      !Number.isInteger((coordinate as { y?: unknown }).y)
    ) {
      return null;
    }
  }
  if (
    payload.displayName !== undefined &&
    (typeof payload.displayName !== 'string' || !isValidRoomDisplayName(payload.displayName))
  ) {
    return null;
  }

  const normalizedInviteCode = payload.inviteCode ? normalizeInviteCode(payload.inviteCode) : null;

  return {
    ...(payload.inviteToken ? { inviteToken: payload.inviteToken } : {}),
    ...(normalizedInviteCode ? { inviteCode: normalizedInviteCode } : {}),
    ...(payload.suggestedCoordinate ? { suggestedCoordinate: payload.suggestedCoordinate } : {}),
    ...(payload.suggestedColorHex ? { suggestedColorHex: payload.suggestedColorHex } : {}),
    ...(payload.displayName ? { displayName: payload.displayName.trim() } : {}),
  };
}

function compactTemplatePixels(
  pixels: RoomPixelTemplatePixelDto[],
  defaultColorHex: HexColor,
): RoomPixelTemplatePixelDto[] {
  const pixelsByCoordinate = new Map<string, RoomPixelTemplatePixelDto>();

  for (const pixel of pixels) {
    const key = `${pixel.x}:${pixel.y}`;
    if (pixel.colorHex === defaultColorHex) {
      pixelsByCoordinate.delete(key);
      continue;
    }

    pixelsByCoordinate.set(key, pixel);
  }

  return [...pixelsByCoordinate.values()].sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

function parseRoomPixelTemplateBody(body: unknown): SaveRoomPixelTemplateRequestDto | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const payload = body as {
    name?: unknown;
    width?: unknown;
    height?: unknown;
    defaultColorHex?: unknown;
    pixels?: unknown;
  };
  if (
    typeof payload.width !== 'number' ||
    typeof payload.height !== 'number' ||
    !Number.isInteger(payload.width) ||
    !Number.isInteger(payload.height)
  ) {
    return null;
  }
  const width = payload.width;
  const height = payload.height;
  if (
    width < FRIEND_ROOM_MIN_CANVAS_DIMENSION ||
    width > FRIEND_ROOM_MAX_CANVAS_DIMENSION ||
    height < FRIEND_ROOM_MIN_CANVAS_DIMENSION ||
    height > FRIEND_ROOM_MAX_CANVAS_DIMENSION
  ) {
    return null;
  }
  if (typeof payload.defaultColorHex !== 'string') {
    return null;
  }

  const defaultColorHex = normalizeHexColor(payload.defaultColorHex);
  if (!defaultColorHex) {
    return null;
  }
  if (!Array.isArray(payload.pixels) || payload.pixels.length > width * height) {
    return null;
  }

  const normalizedPixels: RoomPixelTemplatePixelDto[] = [];
  for (const pixel of payload.pixels) {
    if (!pixel || typeof pixel !== 'object') {
      return null;
    }

    const candidate = pixel as Partial<RoomPixelTemplatePixelDto>;
    const x = candidate.x;
    const y = candidate.y;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      typeof candidate.colorHex !== 'string' ||
      x < 0 ||
      x >= width ||
      y < 0 ||
      y >= height
    ) {
      return null;
    }

    const colorHex = normalizeHexColor(candidate.colorHex);
    if (!colorHex) {
      return null;
    }

    normalizedPixels.push({
      x,
      y,
      colorHex,
    });
  }

  const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (rawName.length > ROOM_PIXEL_TEMPLATE_MAX_NAME_LENGTH) {
    return null;
  }

  return {
    name: rawName || ROOM_PIXEL_TEMPLATE_DEFAULT_NAME,
    width,
    height,
    defaultColorHex,
    pixels: compactTemplatePixels(normalizedPixels, defaultColorHex),
  };
}

function toRoomPixelTemplateDto(
  template: RoomPixelTemplateRecord,
  roomPublicId: string,
): RoomPixelTemplateDto {
  return {
    id: template.id,
    roomPublicId,
    name: template.name,
    width: template.width,
    height: template.height,
    defaultColorHex: template.defaultColorHex,
    pixels: template.pixels,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

function sendQuickPixelRejection(reply: FastifyReply, error: QuickPixelRejectedError) {
  return reply.code(error.statusCode).send({
    error: error.code,
    message: error.friendlyMessage,
    ...(error.allowance ? { remainingMs: error.allowance.remainingMs } : {}),
  });
}

function quickPixelSuggestion(canvasSize: { width: number; height: number }): InviteLandingResponseDto['quickPixelSuggestion'] {
  return {
    x: Math.floor(canvasSize.width / 2),
    y: Math.floor(canvasSize.height / 2),
  };
}

async function ensureMemberFromInviteCredential(
  app: FastifyInstance,
  input: {
    roomId: string;
    actorKey: string;
    inviteToken?: string | undefined;
    inviteCode?: string | undefined;
  },
) {
  if (!input.inviteToken && !input.inviteCode) {
    return null;
  }

  const invite = input.inviteToken
    ? await validateInvite(app.db, input.inviteToken, inviteSecret(app))
    : await validateInviteByCode(app.db, input.inviteCode!, inviteSecret(app));
  if (!invite || invite.roomId !== input.roomId) {
    return null;
  }

  return ensureRoomMember(app.db, {
    roomId: input.roomId,
    actorKey: input.actorKey,
    role: invite.roleOnJoin,
    inviteId: invite.id,
    displayName: null,
  });
}

async function buildInviteLandingResponse(
  app: FastifyInstance,
  request: Parameters<typeof getOrSetActorKey>[0],
  reply: FastifyReply,
  invite: InviteRecord,
): Promise<InviteLandingResponseDto | null> {
  const roomToday = await ensureRoomTodayById(app.db, invite.roomId);
  if (!roomToday) {
    return null;
  }

  const actorKey = getOrSetRoomActorKey(app, request, reply);
  const actorIpHash = hashIpAddress(getRequestIp(request), app.config.ipHashSecret);
  const ownerMember = await getActiveRoomMember(app.db, roomToday.room.id, roomToday.room.ownerActorKey);
  const currentMember = await getActiveRoomMember(app.db, roomToday.room.id, actorKey);
  const participantDisplayName = currentMember?.displayName ?? null;
  const suggestedInviteMember = participantDisplayName
    ? null
    : await getRecentInviteMemberByIpHash(app.db, invite.id, actorIpHash);
  const suggestedParticipantDisplayName = suggestedInviteMember?.displayName ?? null;

  return {
    roomPublicId: roomToday.room.publicId,
    roomName: roomToday.room.name,
    todayDailyCanvasId: roomToday.dailyCanvas.id,
    canvasId: roomToday.canvas.id,
    canvasSize: { width: roomToday.canvas.width, height: roomToday.canvas.height },
    ...(ownerMember?.displayName ? { inviterDisplayName: ownerMember.displayName } : {}),
    ...(participantDisplayName ? { participantDisplayName } : {}),
    ...(suggestedParticipantDisplayName ? { suggestedParticipantDisplayName } : {}),
    quickPixelSuggestion: quickPixelSuggestion(roomToday.canvas),
  };
}

async function consumeInviteCodeLandingAttempt(
  app: FastifyInstance,
  request: Parameters<typeof getOrSetActorKey>[0],
): Promise<boolean> {
  const actorIpHash = hashIpAddress(getRequestIp(request), app.config.ipHashSecret);
  const key = `room:invite-code-landing-attempt:${actorIpHash}`;
  const attemptCount = await app.redis.incr(key);
  if (attemptCount === 1) {
    await app.redis.pexpire(key, INVITE_CODE_LANDING_WINDOW_MS);
  }

  return attemptCount <= INVITE_CODE_LANDING_ATTEMPT_LIMIT;
}

export async function registerRoomRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateRoomRequestDto }>(
    '/api/rooms',
    async (request, reply) => {
      const body = parseCreateRoomBody(request.body);
      if (!body) {
        return reply.code(400).send({ error: 'invalid_room_name' });
      }

      const actorKey = getOrSetRoomActorKey(app, request, reply);
      const created = await createRoomWithTodayCanvas(app.db, {
        name: body.name,
        ownerActorKey: actorKey,
        ownerDisplayName: body.ownerDisplayName,
        inviteSecret: inviteSecret(app),
        expectedParticipantCount: app.config.projectExpectedParticipants,
        targetCompletionMs: app.config.projectTargetCompletionMs,
        pixelAllowanceMaxStorageMs: app.config.pixelAllowanceMaxStorageMs,
        ...(body.canvasDimension ? { canvasDimension: body.canvasDimension } : {}),
      });
      const inviteUrl = buildInviteUrl(
        app.config.webOrigin,
        created.invite.rawToken,
      );

      await recordRoomAnalyticsEvent(app.db, {
        name: 'room_created',
        roomId: created.room.id,
        roomPublicId: created.room.publicId,
        actorKey,
        properties: {
          canvasSize: `${created.canvas.width}x${created.canvas.height}`,
          expectedParticipantCount: created.room.expectedParticipantCount,
        },
      });
      await recordRoomAnalyticsEvent(app.db, {
        name: 'invite_link_created',
        roomId: created.room.id,
        roomPublicId: created.room.publicId,
        actorKey,
        properties: {
          inviteRoute: INVITE_ROUTE_TEMPLATE,
        },
      });

      const response: CreateRoomResponseDto = {
        roomPublicId: created.room.publicId,
        roomName: created.room.name,
        todayDailyCanvasId: created.dailyCanvas.id,
        canvasId: created.canvas.id,
        canvasSize: { width: created.canvas.width, height: created.canvas.height },
        inviteUrl,
        inviteCode: created.invite.rawCode,
        ownerDisplayName: created.ownerMember.displayName ?? body.ownerDisplayName,
      };

      return reply.code(201).send(response);
    },
  );


  app.get<{ Params: { roomPublicId: string }; Querystring: { inviteToken?: string; inviteCode?: string } }>(
    '/api/rooms/:roomPublicId/today',
    async (request, reply) => {
      const roomToday = await ensureRoomToday(app.db, request.params.roomPublicId);
      if (!roomToday) {
        return reply.code(404).send({ error: 'room_not_found' });
      }

      const actorKey = getOrSetRoomActorKey(app, request, reply);
      const member = await getActiveRoomMember(app.db, roomToday.room.id, actorKey)
        ?? await ensureMemberFromInviteCredential(app, {
          roomId: roomToday.room.id,
          actorKey,
          inviteToken: request.query.inviteToken,
          inviteCode: request.query.inviteCode,
        });
      if (!member) {
        return reply.code(404).send({ error: 'room_membership_required' });
      }

      return {
        roomPublicId: roomToday.room.publicId,
        roomName: roomToday.room.name,
        todayDailyCanvasId: roomToday.dailyCanvas.id,
        canvasId: roomToday.canvas.id,
        canvasSize: { width: roomToday.canvas.width, height: roomToday.canvas.height },
        memberRole: member.role,
      };
    },
  );

  app.get<{ Params: { roomPublicId: string }; Querystring: { inviteToken?: string; inviteCode?: string } }>(
    '/api/rooms/:roomPublicId/pixel-template',
    async (request, reply) => {
      const roomToday = await ensureRoomToday(app.db, request.params.roomPublicId);
      if (!roomToday) {
        return reply.code(404).send({ error: 'room_not_found' });
      }

      const actorKey = getOrSetRoomActorKey(app, request, reply);
      const member = await getActiveRoomMember(app.db, roomToday.room.id, actorKey)
        ?? await ensureMemberFromInviteCredential(app, {
          roomId: roomToday.room.id,
          actorKey,
          inviteToken: request.query.inviteToken,
          inviteCode: request.query.inviteCode,
        });
      if (!member) {
        return reply.code(404).send({ error: 'room_membership_required' });
      }

      const template = await getRoomPixelTemplate(app.db, roomToday.room.id);
      const response: RoomPixelTemplateResponseDto = {
        template: template ? toRoomPixelTemplateDto(template, roomToday.room.publicId) : null,
      };

      return response;
    },
  );

  app.put<{
    Params: { roomPublicId: string };
    Querystring: { inviteToken?: string; inviteCode?: string };
    Body: SaveRoomPixelTemplateRequestDto;
  }>(
    '/api/rooms/:roomPublicId/pixel-template',
    async (request, reply) => {
      const body = parseRoomPixelTemplateBody(request.body);
      if (!body) {
        return reply.code(400).send({ error: 'invalid_pixel_template' });
      }

      const roomToday = await ensureRoomToday(app.db, request.params.roomPublicId);
      if (!roomToday) {
        return reply.code(404).send({ error: 'room_not_found' });
      }

      const actorKey = getOrSetRoomActorKey(app, request, reply);
      const member = await getActiveRoomMember(app.db, roomToday.room.id, actorKey)
        ?? await ensureMemberFromInviteCredential(app, {
          roomId: roomToday.room.id,
          actorKey,
          inviteToken: request.query.inviteToken,
          inviteCode: request.query.inviteCode,
        });
      if (!member) {
        return reply.code(404).send({ error: 'room_membership_required' });
      }
      if (member.role !== 'owner') {
        return reply.code(403).send({ error: 'room_owner_required' });
      }

      const template = await replaceRoomPixelTemplate(app.db, {
        roomId: roomToday.room.id,
        createdByMemberId: member.id,
        name: body.name ?? ROOM_PIXEL_TEMPLATE_DEFAULT_NAME,
        width: body.width,
        height: body.height,
        defaultColorHex: body.defaultColorHex,
        pixels: body.pixels,
      });
      const response: SaveRoomPixelTemplateResponseDto = {
        template: toRoomPixelTemplateDto(template, roomToday.room.publicId),
      };

      try {
        app.pixelSocketServer?.broadcastRoomPixelTemplateUpdated?.(roomToday.canvas.id, {
          roomPublicId: roomToday.room.publicId,
          template: response.template,
        });
      } catch (error) {
        app.log.error({ err: error }, 'Failed to broadcast room pixel template update');
      }

      return response;
    },
  );

  app.post<{ Params: { roomPublicId: string }; Querystring: { inviteToken?: string; inviteCode?: string } }>(
    '/api/rooms/:roomPublicId/invites',
    async (request, reply) => {
      const roomToday = await ensureRoomToday(app.db, request.params.roomPublicId);
      if (!roomToday) {
        return reply.code(404).send({ error: 'room_not_found' });
      }

      const actorKey = getOrSetRoomActorKey(app, request, reply);
      const member = await getActiveRoomMember(app.db, roomToday.room.id, actorKey)
        ?? await ensureMemberFromInviteCredential(app, {
          roomId: roomToday.room.id,
          actorKey,
          inviteToken: request.query.inviteToken,
          inviteCode: request.query.inviteCode,
        });
      if (!member) {
        return reply.code(404).send({ error: 'room_membership_required' });
      }

      const invite = await createInvite(app.db, {
        roomId: roomToday.room.id,
        createdByMemberId: member.id,
        inviteSecret: inviteSecret(app),
      });
      const inviteUrl = buildInviteUrl(app.config.webOrigin, invite.rawToken);

      await recordRoomAnalyticsEvent(app.db, {
        name: 'invite_link_created',
        roomId: roomToday.room.id,
        roomPublicId: roomToday.room.publicId,
        actorKey,
        properties: {
          inviteRoute: INVITE_ROUTE_TEMPLATE,
        },
      });

      const response: CreateRoomInviteResponseDto = {
        roomPublicId: roomToday.room.publicId,
        inviteUrl,
        inviteCode: invite.rawCode,
      };

      return reply.code(201).send(response);
    },
  );

  app.get<{ Params: { inviteToken: string } }>(
    '/api/invites/:inviteToken/landing',
    async (request, reply) => {
      const invite = await validateInvite(
        app.db,
        request.params.inviteToken,
        inviteSecret(app),
      );
      if (!invite) {
        return sendInvalidInvite(reply);
      }

      const response = await buildInviteLandingResponse(app, request, reply, invite);
      if (!response) {
        return sendInvalidInvite(reply);
      }

      return response;
    },
  );

  app.get<{ Params: { inviteCode: string } }>(
    '/api/invite-codes/:inviteCode/landing',
    async (request, reply) => {
      if (!(await consumeInviteCodeLandingAttempt(app, request))) {
        return sendInviteCodeRateLimit(reply);
      }

      const invite = await validateInviteByCode(
        app.db,
        request.params.inviteCode,
        inviteSecret(app),
      );
      if (!invite) {
        return sendInvalidInvite(reply);
      }

      const response = await buildInviteLandingResponse(app, request, reply, invite);
      if (!response) {
        return sendInvalidInvite(reply);
      }

      return response;
    },
  );

  app.post<{
    Params: { roomPublicId: string };
    Body: QuickPixelRequestDto;
  }>('/api/rooms/:roomPublicId/quick-pixel', async (request, reply) => {
    const body = parseQuickPixelBody(request.body);
    if (!body) {
      return reply.code(400).send({ error: 'invalid_quick_pixel_request' });
    }

    const actorKey = getOrSetRoomActorKey(app, request, reply);

    try {
      const response = await placeQuickPixel({
        db: app.db,
        allowanceStore: new RedisPixelAllowanceStore(app.redis),
        inviteSecret: inviteSecret(app),
        roomPublicId: request.params.roomPublicId,
        actorKey,
        actorIpHash: hashIpAddress(getRequestIp(request), app.config.ipHashSecret),
        inviteToken: body.inviteToken,
        inviteCode: body.inviteCode,
        displayName: body.displayName,
        suggestedColorHex: body.suggestedColorHex,
        suggestedCoordinate: body.suggestedCoordinate,
        unlimitedPixelPlacement: app.config.unlimitedPixelPlacement,
      });

      const broadcastQuickPixelPlaced = app.pixelSocketServer?.broadcastQuickPixelPlaced;
      if (broadcastQuickPixelPlaced) {
        void Promise.resolve()
          .then(() => broadcastQuickPixelPlaced(response, { actorKey }))
          .catch((handoffError) => {
            app.log.error({ err: handoffError }, 'Failed to hand off Quick Pixel realtime broadcast');
          });
      }

      return reply.code(201).send(response);
    } catch (error) {
      if (error instanceof QuickPixelRejectedError) {
        return sendQuickPixelRejection(reply, error);
      }
      throw error;
    }
  });

  app.patch<{
    Params: { roomPublicId: string };
    Body: OptionalDisplayNameRequestDto;
  }>('/api/rooms/:roomPublicId/me', async (request, reply) => {
    const displayName = parseOptionalDisplayNameBody(request.body);
    if (displayName === undefined) {
      return reply.code(400).send({ error: 'invalid_display_name' });
    }

    const roomToday = await ensureRoomToday(app.db, request.params.roomPublicId);
    if (!roomToday) {
      return reply.code(404).send({ error: 'room_membership_required' });
    }

    const actorKey = getOrSetRoomActorKey(app, request, reply);
    const member = await getActiveRoomMember(
      app.db,
      roomToday.room.id,
      actorKey,
    );
    if (!member) {
      return reply.code(404).send({ error: 'room_membership_required' });
    }

    const updatedMember = await updateRoomMemberDisplayName(
      app.db,
      roomToday.room.id,
      actorKey,
      displayName,
    );
    if (!updatedMember) {
      return reply.code(404).send({ error: 'room_membership_required' });
    }

    await recordRoomAnalyticsEvent(app.db, {
      name:
        displayName === null
          ? 'optional_display_name_skipped'
          : 'optional_display_name_set',
      roomId: roomToday.room.id,
      roomPublicId: roomToday.room.publicId,
      actorKey,
      properties: { hasDisplayName: displayName !== null },
    });

    const response: OptionalDisplayNameResponseDto = {
      roomPublicId: roomToday.room.publicId,
      displayName: updatedMember.displayName,
    };

    return response;
  });
}
