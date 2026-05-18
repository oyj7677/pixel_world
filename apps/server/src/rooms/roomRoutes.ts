import {
  FRIEND_ROOM_CANVAS_SIZE,
  FRIEND_ROOM_ROUTES,
  type CreateRoomInviteResponseDto,
  type CreateRoomRequestDto,
  type CreateRoomResponseDto,
  type InviteLandingResponseDto,
  type OptionalDisplayNameRequestDto,
  type OptionalDisplayNameResponseDto,
  type QuickPixelRequestDto,
  isValidRoomDisplayName,
  isValidRoomName,
} from '@pixel-world/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getOrSetActorKey, getRequestIp, hashIpAddress } from '../auth/actorIdentity';
import {
  createInvite,
  createRoomWithTodayCanvas,
  getActiveRoomMember,
  getRecentInviteMemberByIpHash,
  getRoomToday,
  getRoomTodayById,
  updateRoomMemberDisplayName,
  validateInvite,
} from './roomRepository';
import { RedisPixelAllowanceStore } from '../services/pixelAllowanceService';
import { placeQuickPixel, QuickPixelRejectedError } from './quickPixelService';
import { recordRoomAnalyticsEvent } from './roomAnalytics';

const MAX_DISPLAY_NAME_LENGTH = 40;

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
  if (typeof name !== 'string' || !isValidRoomName(name)) {
    return null;
  }
  if (typeof ownerDisplayName !== 'string' || !isValidRoomDisplayName(ownerDisplayName)) {
    return null;
  }

  return { name: name.trim(), ownerDisplayName: ownerDisplayName.trim() };
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
  if (payload.suggestedColorHex !== undefined && typeof payload.suggestedColorHex !== 'string') {
    return null;
  }
  if (
    payload.displayName !== undefined &&
    (typeof payload.displayName !== 'string' || !isValidRoomDisplayName(payload.displayName))
  ) {
    return null;
  }

  return {
    ...(payload.inviteToken ? { inviteToken: payload.inviteToken } : {}),
    ...(payload.suggestedColorHex ? { suggestedColorHex: payload.suggestedColorHex } : {}),
    ...(payload.displayName ? { displayName: payload.displayName.trim() } : {}),
  };
}

function sendQuickPixelRejection(reply: FastifyReply, error: QuickPixelRejectedError) {
  return reply.code(error.statusCode).send({
    error: error.code,
    message: error.friendlyMessage,
    ...(error.allowance ? { remainingMs: error.allowance.remainingMs } : {}),
  });
}

function quickPixelSuggestion(): InviteLandingResponseDto['quickPixelSuggestion'] {
  return {
    x: Math.floor(FRIEND_ROOM_CANVAS_SIZE.width / 2),
    y: Math.floor(FRIEND_ROOM_CANVAS_SIZE.height / 2),
  };
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
          inviteRoute: '/invite/:token',
        },
      });

      const response: CreateRoomResponseDto = {
        roomPublicId: created.room.publicId,
        roomName: created.room.name,
        todayDailyCanvasId: created.dailyCanvas.id,
        canvasId: created.canvas.id,
        inviteUrl,
        ownerDisplayName: created.ownerMember.displayName ?? body.ownerDisplayName,
      };

      return reply.code(201).send(response);
    },
  );


  app.get<{ Params: { roomPublicId: string } }>(
    '/api/rooms/:roomPublicId/today',
    async (request, reply) => {
      const roomToday = await getRoomToday(app.db, request.params.roomPublicId);
      if (!roomToday) {
        return reply.code(404).send({ error: 'room_not_found' });
      }

      const actorKey = getOrSetRoomActorKey(app, request, reply);
      const member = await getActiveRoomMember(app.db, roomToday.room.id, actorKey);
      if (!member) {
        return reply.code(404).send({ error: 'room_membership_required' });
      }

      return {
        roomPublicId: roomToday.room.publicId,
        roomName: roomToday.room.name,
        todayDailyCanvasId: roomToday.dailyCanvas.id,
        canvasId: roomToday.canvas.id,
        canvasSize: { width: roomToday.canvas.width, height: roomToday.canvas.height }
      };
    },
  );

  app.post<{ Params: { roomPublicId: string } }>(
    '/api/rooms/:roomPublicId/invites',
    async (request, reply) => {
      const roomToday = await getRoomToday(app.db, request.params.roomPublicId);
      if (!roomToday) {
        return reply.code(404).send({ error: 'room_not_found' });
      }

      const actorKey = getOrSetRoomActorKey(app, request, reply);
      const member = await getActiveRoomMember(app.db, roomToday.room.id, actorKey);
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
          inviteRoute: '/invite/:token',
        },
      });

      const response: CreateRoomInviteResponseDto = {
        roomPublicId: roomToday.room.publicId,
        inviteUrl,
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

      const roomToday = await getRoomTodayById(app.db, invite.roomId);
      if (!roomToday) {
        return sendInvalidInvite(reply);
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

      const response: InviteLandingResponseDto = {
        roomPublicId: roomToday.room.publicId,
        roomName: roomToday.room.name,
        todayDailyCanvasId: roomToday.dailyCanvas.id,
        canvasId: roomToday.canvas.id,
        canvasSize: FRIEND_ROOM_CANVAS_SIZE,
        ...(ownerMember?.displayName ? { inviterDisplayName: ownerMember.displayName } : {}),
        ...(participantDisplayName ? { participantDisplayName } : {}),
        ...(suggestedParticipantDisplayName ? { suggestedParticipantDisplayName } : {}),
        quickPixelSuggestion: quickPixelSuggestion(),
      };

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
    const suggestion = quickPixelSuggestion();

    try {
      const response = await placeQuickPixel({
        db: app.db,
        allowanceStore: new RedisPixelAllowanceStore(app.redis),
        inviteSecret: inviteSecret(app),
        roomPublicId: request.params.roomPublicId,
        actorKey,
        actorIpHash: hashIpAddress(getRequestIp(request), app.config.ipHashSecret),
        inviteToken: body.inviteToken,
        displayName: body.displayName,
        suggestedColorHex: body.suggestedColorHex,
        suggestedCoordinate: { x: suggestion.x, y: suggestion.y },
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

    const roomToday = await getRoomToday(app.db, request.params.roomPublicId);
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
