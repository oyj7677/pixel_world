import type { IncomingMessage } from 'node:http';
import fastifyCookie, { sign, unsign } from '@fastify/cookie';
import {
  ACTOR_COOKIE,
  createActorKey,
  hashIpAddress,
  readSignedActorCookie
} from '../auth/actorIdentity';
import type { FastifyInstance } from 'fastify';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  DEFAULT_CANVAS_ID,
  calculateDynamicAllowanceIntervalMs,
  calculateMaxSavedPixelCount,
  calculateRequiredPixelCount,
  normalizeHexColor,
  validateCoordinate,
  type CanvasSnapshotPayload,
  type ClientToServerEvents,
  type CooldownUpdatedPayload,
  type HexColor,
  type PixelAllowanceStatePayload,
  type PixelUpdatedPayload,
  type QuickPixelResponseDto,
  type PlacePixelPayload,
  type PlacementRejectedPayload,
  type PresenceUpdatedPayload,
  type RecentEventsUpdatedPayload,
  type ServerToClientEvents
} from '@pixel-world/shared';
import {
  getCanvasSnapshot,
  getPublicRecentEvents,
  getPublicRecentEventsForActor,
  isActorBlocked,
  upsertPixelAndLog
} from '../db/canvasRepository';
import {
  checkAndConsumePixelAllowance,
  getPixelAllowanceState,
  getUnlimitedPixelAllowanceState,
  refundPixelAllowance,
  RedisPixelAllowanceStore,
  type PixelAllowanceResult,
  type PixelAllowancePolicySnapshot
} from '../services/pixelAllowanceService';
import {
  ensureRoomToday,
  ensureRoomMember,
  getActiveRoomMember,
  getRoomTodayIncludingArchived,
  validateInvite,
  validateInviteByCode,
  type DailyCanvasRecord
} from '../rooms/roomRepository';
import type { CookieSameSite } from '../config';

const RECENT_EVENT_LIMIT = 25;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const MAX_QUEUED_PLACE_PIXELS_PER_SOCKET = 1;

interface ProjectAllowancePolicy {
  targetCompletionMs: number;
  requiredPixelCount: number;
  effectiveParticipantCount: number;
  dynamicAllowanceIntervalMs: number;
  pixelAllowanceMaxStorageMs: number;
  maxSavedPixelCount: number;
}

interface SocketActorIdentity {
  actorKey: string;
  actorIpHash: string;
}

interface RealtimeCanvasContext {
  kind: 'global' | 'room';
  canvasId: string;
  roomPublicId?: string;
  dailyCanvasId?: string;
  width: number;
  height: number;
  allowanceScopeKey: string;
  allowancePolicy: ProjectAllowancePolicy;
  roomId?: string;
}

interface RoomSocketData {
  actorKey: string;
  context: RealtimeCanvasContext;
}

function canvasRoomName(canvasId: string): string {
  return `canvas:${canvasId}`;
}

function roomAllowanceScopeKey(canvasId: string): string {
  return `canvas:${canvasId}`;
}

function getQueryString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function allowancePolicyFromDailyCanvas(dailyCanvas: DailyCanvasRecord): ProjectAllowancePolicy & PixelAllowancePolicySnapshot {
  return {
    targetCompletionMs: dailyCanvas.targetCompletionMs,
    requiredPixelCount: dailyCanvas.requiredPixelCount,
    effectiveParticipantCount: dailyCanvas.expectedParticipantCount,
    dynamicAllowanceIntervalMs: dailyCanvas.pixelAllowanceIntervalMs,
    pixelAllowanceMaxStorageMs: dailyCanvas.pixelAllowanceMaxStorageMs,
    maxSavedPixelCount: calculateMaxSavedPixelCount({
      maxStorageMs: dailyCanvas.pixelAllowanceMaxStorageMs,
      allowanceIntervalMs: dailyCanvas.pixelAllowanceIntervalMs
    })
  };
}

function isValidCanvasCoordinate(context: RealtimeCanvasContext, x: number, y: number, app: FastifyInstance): boolean {
  if (context.kind === 'global') {
    return validateCoordinate(app.config.policy, x, y).ok;
  }

  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < context.width && y >= 0 && y < context.height;
}

function toSocketData(socket: PixelSocket): RoomSocketData | undefined {
  return (socket.data as Partial<RoomSocketData>).actorKey && (socket.data as Partial<RoomSocketData>).context
    ? (socket.data as RoomSocketData)
    : undefined;
}

type PixelSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface QuickPixelRealtimeMetadata {
  actorKey: string;
}

export interface QuickPixelRealtimeHandoff {
  broadcastQuickPixelPlaced?: (payload: QuickPixelResponseDto, metadata: QuickPixelRealtimeMetadata) => Promise<void> | void;
  broadcastPixelUpdated?: (payload: PixelUpdatedPayload) => void;
}

export type PixelSocketServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents> & QuickPixelRealtimeHandoff;

function getCookieHeader(request: IncomingMessage): string {
  const cookieHeader = request.headers.cookie;
  return Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader ?? '';
}

function readActorKeyFromRequest(request: IncomingMessage, cookieSecret: string): string | undefined {
  const cookies = fastifyCookie.parse(getCookieHeader(request));
  return readSignedActorCookie(cookies, (value) => unsign(value, cookieSecret));
}

function serializeActorCookie(
  actorKey: string,
  cookieSecret: string,
  secureCookie: boolean,
  sameSite: CookieSameSite
): string {
  return fastifyCookie.serialize(ACTOR_COOKIE, sign(actorKey, cookieSecret), {
    httpOnly: true,
    sameSite,
    path: '/',
    secure: secureCookie,
    maxAge: ONE_YEAR_SECONDS
  });
}

function getOrCreateSocketActorKey(request: IncomingMessage, cookieSecret: string): {
  actorKey: string;
  shouldSetCookie: boolean;
} {
  const existing = readActorKeyFromRequest(request, cookieSecret);
  if (existing) {
    return { actorKey: existing, shouldSetCookie: false };
  }

  return { actorKey: createActorKey(), shouldSetCookie: true };
}

function getSocketIp(socket: PixelSocket): string {
  return socket.handshake.address || socket.request.socket.remoteAddress || 'unknown';
}

function asPlacePixelPayload(value: unknown): PlacePixelPayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const payload = value as Record<string, unknown>;
  if (
    typeof payload.canvasId !== 'string' ||
    typeof payload.x !== 'number' ||
    typeof payload.y !== 'number' ||
    typeof payload.colorHex !== 'string'
  ) {
    return null;
  }

  return {
    ...(typeof payload.roomPublicId === 'string' ? { roomPublicId: payload.roomPublicId } : {}),
    ...(typeof payload.dailyCanvasId === 'string' ? { dailyCanvasId: payload.dailyCanvasId } : {}),
    canvasId: payload.canvasId,
    x: payload.x,
    y: payload.y,
    colorHex: payload.colorHex
  };
}

function rejectPlacement(socket: PixelSocket, payload: PlacementRejectedPayload): void {
  socket.emit('placementRejected', payload);
}

function getProjectAllowancePolicy(app: FastifyInstance): ProjectAllowancePolicy {
  const requiredPixelCount = calculateRequiredPixelCount({
    width: app.config.policy.width,
    height: app.config.policy.height
  });
  const dynamicAllowanceIntervalMs = calculateDynamicAllowanceIntervalMs({
    targetCompletionMs: app.config.projectTargetCompletionMs,
    effectiveParticipantCount: app.config.projectExpectedParticipants,
    requiredPixelCount
  });
  const maxSavedPixelCount = calculateMaxSavedPixelCount({
    maxStorageMs: app.config.pixelAllowanceMaxStorageMs,
    allowanceIntervalMs: dynamicAllowanceIntervalMs
  });

  return {
    targetCompletionMs: app.config.projectTargetCompletionMs,
    requiredPixelCount,
    effectiveParticipantCount: app.config.projectExpectedParticipants,
    dynamicAllowanceIntervalMs,
    pixelAllowanceMaxStorageMs: app.config.pixelAllowanceMaxStorageMs,
    maxSavedPixelCount
  };
}

function toPixelAllowanceStatePayload(
  policy: ProjectAllowancePolicy,
  result: Pick<PixelAllowanceResult, 'savedPixelCount' | 'maxSavedPixelCount' | 'nextPixelSavedAtMs' | 'maxStorageEndsAtMs'>
): PixelAllowanceStatePayload {
  return {
    targetCompletionMs: policy.targetCompletionMs,
    requiredPixelCount: policy.requiredPixelCount,
    effectiveParticipantCount: policy.effectiveParticipantCount,
    dynamicAllowanceIntervalMs: policy.dynamicAllowanceIntervalMs,
    savedPixelCount: result.savedPixelCount,
    maxSavedPixelCount: result.maxSavedPixelCount,
    nextPixelSavedAt: new Date(result.nextPixelSavedAtMs).toISOString(),
    maxStorageEndsAt: new Date(result.maxStorageEndsAtMs).toISOString()
  };
}

function toAllowanceUpdatedPayload(policy: ProjectAllowancePolicy, result: PixelAllowanceResult): CooldownUpdatedPayload {
  const state = toPixelAllowanceStatePayload(policy, result);

  return {
    ...state,
    nextAvailableAt: state.nextPixelSavedAt,
    remainingMs: result.remainingMs
  };
}

function setHeader(headers: Record<string, string | string[]>, name: string, value: string): void {
  const existing = headers[name];
  if (!existing) {
    headers[name] = value;
    return;
  }

  headers[name] = Array.isArray(existing) ? [...existing, value] : [existing, value];
}

async function resolveSocketContext(
  app: FastifyInstance,
  socket: PixelSocket,
  actorKey: string,
  globalAllowancePolicy: ProjectAllowancePolicy
): Promise<RealtimeCanvasContext> {
  const roomPublicId = getQueryString(socket.handshake.query.roomPublicId);
  if (!roomPublicId) {
    return {
      kind: 'global',
      canvasId: DEFAULT_CANVAS_ID,
      width: app.config.policy.width,
      height: app.config.policy.height,
      allowanceScopeKey: DEFAULT_CANVAS_ID,
      allowancePolicy: globalAllowancePolicy
    };
  }

  const dailyCanvasId = getQueryString(socket.handshake.query.dailyCanvasId);
  const date = getQueryString(socket.handshake.query.date);
  if (!dailyCanvasId && date !== 'today') {
    throw new Error('room_join_rejected');
  }

  const roomToday = await ensureRoomToday(app.db, roomPublicId);
  if (!roomToday || (dailyCanvasId && dailyCanvasId !== roomToday.dailyCanvas.id)) {
    throw new Error('room_join_rejected');
  }

  const member = await getActiveRoomMember(app.db, roomToday.room.id, actorKey);
  if (!member) {
    const inviteToken = getQueryString(socket.handshake.query.inviteToken);
    const inviteCode = getQueryString(socket.handshake.query.inviteCode);
    const invite = inviteToken
      ? await validateInvite(app.db, inviteToken, app.config.cookieSecret)
      : inviteCode
        ? await validateInviteByCode(app.db, inviteCode, app.config.cookieSecret)
        : null;
    if (!invite || invite.roomId !== roomToday.room.id) {
      throw new Error('room_join_rejected');
    }

    await ensureRoomMember(app.db, {
      roomId: roomToday.room.id,
      actorKey,
      role: invite.roleOnJoin,
      inviteId: invite.id,
      displayName: null,
    });
  }

  return {
    kind: 'room',
    roomPublicId: roomToday.room.publicId,
    dailyCanvasId: roomToday.dailyCanvas.id,
    canvasId: roomToday.canvas.id,
    roomId: roomToday.room.id,
    width: roomToday.canvas.width,
    height: roomToday.canvas.height,
    allowanceScopeKey: roomAllowanceScopeKey(roomToday.canvas.id),
    allowancePolicy: allowancePolicyFromDailyCanvas(roomToday.dailyCanvas)
  };
}

async function isRoomContextWritable(app: FastifyInstance, context: RealtimeCanvasContext): Promise<boolean> {
  if (context.kind !== 'room' || !context.roomPublicId || !context.dailyCanvasId) {
    return true;
  }

  const roomToday = await getRoomTodayIncludingArchived(app.db, context.roomPublicId);

  return Boolean(
    roomToday &&
      !roomToday.room.archivedAt &&
      roomToday.dailyCanvas.status === 'active' &&
      roomToday.dailyCanvas.id === context.dailyCanvasId &&
      roomToday.canvas.id === context.canvasId
  );
}

function contextMetadata(context: RealtimeCanvasContext): Pick<PixelUpdatedPayload, 'roomPublicId' | 'dailyCanvasId'> {
  return context.kind === 'room'
    ? { roomPublicId: context.roomPublicId!, dailyCanvasId: context.dailyCanvasId! }
    : {};
}

function recentEventsPayload(
  context: RealtimeCanvasContext,
  events: RecentEventsUpdatedPayload['events']
): RecentEventsUpdatedPayload {
  return {
    ...contextMetadata(context),
    events
  };
}

export function attachRealtimeSocketServer(app: FastifyInstance): PixelSocketServer {
  const requestActorKeys = new WeakMap<IncomingMessage, string>();
  const pixelAllowanceStore = new RedisPixelAllowanceStore(app.redis);
  const allowancePolicy = getProjectAllowancePolicy(app);
  const onlineCountsByCanvas = new Map<string, number>();

  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(app.server, {
    cors: {
      origin: app.config.webOrigin,
      credentials: true
    },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      if (!origin || origin === app.config.webOrigin) {
        callback(null, true);
        return;
      }

      callback('origin_not_allowed', false);
    }
  });
  const pixelIo = io as PixelSocketServer;
  app.decorate('pixelSocketServer', pixelIo);

  io.engine.on('initial_headers', (headers, request) => {
    const { actorKey, shouldSetCookie } = getOrCreateSocketActorKey(request, app.config.cookieSecret);
    requestActorKeys.set(request, actorKey);

    if (shouldSetCookie) {
      setHeader(
        headers,
        'set-cookie',
        serializeActorCookie(
          actorKey,
          app.config.cookieSecret,
          app.config.secureCookies,
          app.config.cookieSameSite
        )
      );
    }
  });

  io.use((socket, next) => {
    void (async () => {
      const actorKey =
        requestActorKeys.get(socket.request) ??
        readActorKeyFromRequest(socket.request, app.config.cookieSecret) ??
        createActorKey();
      const context = await resolveSocketContext(app, socket, actorKey, allowancePolicy);
      (socket.data as RoomSocketData).actorKey = actorKey;
      (socket.data as RoomSocketData).context = context;
      next();
    })().catch((error) => {
      app.log.warn({ err: error }, 'Rejected Socket.IO room join');
      next(new Error('room_join_rejected'));
    });
  });

  io.on('connection', async (socket) => {
    const socketData = toSocketData(socket);
    const actorKey = socketData?.actorKey ??
      requestActorKeys.get(socket.request) ??
      readActorKeyFromRequest(socket.request, app.config.cookieSecret) ??
      createActorKey();
    const context = socketData?.context ?? {
      kind: 'global' as const,
      canvasId: DEFAULT_CANVAS_ID,
      width: app.config.policy.width,
      height: app.config.policy.height,
      allowanceScopeKey: DEFAULT_CANVAS_ID,
      allowancePolicy
    };
    const actorIpHash = hashIpAddress(getSocketIp(socket), app.config.ipHashSecret);
    const actorIdentity: SocketActorIdentity = { actorKey, actorIpHash };
    const socketRoom = canvasRoomName(context.canvasId);

    await socket.join(socketRoom);
    const onlineCount = (onlineCountsByCanvas.get(context.canvasId) ?? 0) + 1;
    onlineCountsByCanvas.set(context.canvasId, onlineCount);
    const presencePayload: PresenceUpdatedPayload = { onlineCount };
    io.to(socketRoom).emit('presenceUpdated', presencePayload);

    let acceptsPlacements = false;
    let connectionOpen = true;
    const queuedPlacePixelPayloads: PlacePixelPayload[] = [];

    const handlePlacePixel = async (rawPayload: unknown) => {
      const payload = asPlacePixelPayload(rawPayload);
      if (
        !payload ||
        payload.canvasId !== context.canvasId ||
        (context.kind === 'room' &&
          (payload.roomPublicId !== context.roomPublicId || payload.dailyCanvasId !== context.dailyCanvasId))
      ) {
        rejectPlacement(socket, {
          reason: 'invalid_canvas',
          message: 'Unknown canvas.'
        });
        return;
      }

      if (context.kind === 'room') {
        if (!(await isRoomContextWritable(app, context))) {
          rejectPlacement(socket, {
            reason: 'invalid_canvas',
            message: 'Room canvas is no longer accepting pixels.'
          });
          return;
        }

        const member = await getActiveRoomMember(app.db, context.roomId!, actorIdentity.actorKey);
        if (!member) {
          rejectPlacement(socket, {
            reason: 'invalid_canvas',
            message: 'Room membership is required to place pixels.'
          });
          return;
        }
      }

      if (!isValidCanvasCoordinate(context, payload.x, payload.y, app)) {
        rejectPlacement(socket, {
          reason: 'invalid_coordinate',
          message: 'Pixel coordinate is outside the canvas.'
        });
        return;
      }

      const colorHex = normalizeHexColor(payload.colorHex);
      if (!colorHex) {
        rejectPlacement(socket, {
          reason: 'invalid_color',
          message: 'Pixel color must be a valid hex color.'
        });
        return;
      }

      try {
        if (await isActorBlocked(app.db, {
          actorKey: actorIdentity.actorKey,
          actorIpHash: actorIdentity.actorIpHash,
          roomId: context.roomId ?? null,
          dailyCanvasId: context.dailyCanvasId ?? null,
          canvasId: context.canvasId ?? null
        })) {
          rejectPlacement(socket, {
            reason: 'blocked',
            message: 'Pixel placement is blocked for this actor.'
          });
          return;
        }

        const nowMs = Date.now();
        const allowance = app.config.unlimitedPixelPlacement
          ? getUnlimitedPixelAllowanceState(nowMs, context.allowancePolicy)
          : await checkAndConsumePixelAllowance(
              pixelAllowanceStore,
              context.allowanceScopeKey,
              actorIdentity.actorKey,
              nowMs,
              context.allowancePolicy
            );

        if (!allowance.allowed) {
          const allowancePayload = toAllowanceUpdatedPayload(context.allowancePolicy, allowance);
          socket.emit('cooldownUpdated', allowancePayload);
          rejectPlacement(socket, {
            reason: 'cooldown_active',
            message: 'No saved pixels are ready yet.',
            remainingMs: allowance.remainingMs
          });
          return;
        }

        let event: Awaited<ReturnType<typeof upsertPixelAndLog>>;
        try {
          event = await upsertPixelAndLog(app.db, {
            canvasId: payload.canvasId,
            x: payload.x,
            y: payload.y,
            colorHex: colorHex as HexColor,
            actorKey: actorIdentity.actorKey,
            actorIpHash: actorIdentity.actorIpHash,
            source: 'user'
          });
        } catch (error) {
          if (!app.config.unlimitedPixelPlacement) {
            try {
              await refundPixelAllowance(
                pixelAllowanceStore,
                context.allowanceScopeKey,
                actorIdentity.actorKey,
                Date.now(),
                context.allowancePolicy
              );
            } catch (refundError) {
              app.log.error({ err: refundError }, 'Failed to refund Socket.IO pixel allowance after placement failure');
            }
          }

          throw error;
        }

        const pixelUpdated: PixelUpdatedPayload = {
          ...contextMetadata(context),
          canvasId: payload.canvasId,
          x: payload.x,
          y: payload.y,
          colorHex,
          updatedAt: event.createdAt
        };
        const cooldownUpdated = toAllowanceUpdatedPayload(context.allowancePolicy, allowance);

        pixelIo.broadcastPixelUpdated!(pixelUpdated);
        socket.emit('cooldownUpdated', cooldownUpdated);

        try {
          const personalRecentEvents = await getPublicRecentEventsForActor(
            app.db,
            payload.canvasId,
            actorIdentity.actorKey,
            RECENT_EVENT_LIMIT
          );
          if (context.kind === 'room') {
            const roomRecentEvents = await getPublicRecentEvents(app.db, payload.canvasId, RECENT_EVENT_LIMIT);
            io.to(socketRoom).emit('roomRecentEventsUpdated', recentEventsPayload(context, roomRecentEvents));
            socket.emit('myRecentEventsUpdated', recentEventsPayload(context, personalRecentEvents));
          } else {
            socket.emit('recentEventsUpdated', { events: personalRecentEvents });
          }
        } catch (error) {
          app.log.error({ err: error }, 'Failed to broadcast Socket.IO recent events update');
        }
      } catch (error) {
        app.log.error({ err: error }, 'Failed to place pixel over Socket.IO');
        rejectPlacement(socket, {
          reason: 'server_error',
          message: 'Unable to place pixel.'
        });
      }
    };

    function enqueuePlacePixel(rawPayload: unknown): void {
      const payload = asPlacePixelPayload(rawPayload);
      if (!payload) {
        rejectPlacement(socket, {
          reason: 'invalid_canvas',
          message: 'Malformed placement payload.'
        });
        return;
      }

      if (queuedPlacePixelPayloads.length >= MAX_QUEUED_PLACE_PIXELS_PER_SOCKET) {
        rejectPlacement(socket, {
          reason: 'server_error',
          message: 'Canvas is still loading. Please wait for the first snapshot.'
        });
        return;
      }

      queuedPlacePixelPayloads.push(payload);
    }

    async function flushQueuedPlacements() {
      while (queuedPlacePixelPayloads.length > 0 && connectionOpen) {
        const payload = queuedPlacePixelPayloads.shift();
        if (payload) {
          await handlePlacePixel(payload);
        }
      }
    }

    socket.on('placePixel', (rawPayload: unknown) => {
      if (!connectionOpen) {
        return;
      }

      if (!acceptsPlacements) {
        enqueuePlacePixel(rawPayload);
        return;
      }

      void handlePlacePixel(rawPayload);
    });

    socket.on('disconnect', () => {
      connectionOpen = false;
      queuedPlacePixelPayloads.splice(0);
      const updatedOnlineCount = Math.max(0, (onlineCountsByCanvas.get(context.canvasId) ?? 1) - 1);
      if (updatedOnlineCount === 0) {
        onlineCountsByCanvas.delete(context.canvasId);
      } else {
        onlineCountsByCanvas.set(context.canvasId, updatedOnlineCount);
      }
      const updatedPresencePayload: PresenceUpdatedPayload = { onlineCount: updatedOnlineCount };
      io.to(socketRoom).emit('presenceUpdated', updatedPresencePayload);
    });

    try {
      const snapshotNowMs = Date.now();
      const [snapshot, recentEvents, roomRecentEvents, allowanceState] = await Promise.all([
        getCanvasSnapshot(app.db, context.canvasId),
        getPublicRecentEventsForActor(app.db, context.canvasId, actorIdentity.actorKey, RECENT_EVENT_LIMIT),
        context.kind === 'room' ? getPublicRecentEvents(app.db, context.canvasId, RECENT_EVENT_LIMIT) : Promise.resolve(null),
        app.config.unlimitedPixelPlacement
          ? Promise.resolve(getUnlimitedPixelAllowanceState(snapshotNowMs, context.allowancePolicy))
          : getPixelAllowanceState(
              pixelAllowanceStore,
              context.allowanceScopeKey,
              actorIdentity.actorKey,
              snapshotNowMs,
              context.allowancePolicy
            )
      ]);
      const pixelAllowance = toPixelAllowanceStatePayload(context.allowancePolicy, allowanceState);
      const canvasSnapshot: CanvasSnapshotPayload = {
        ...contextMetadata(context),
        ...snapshot,
        recentEvents,
        ...(roomRecentEvents ? { roomRecentEvents } : {}),
        onlineCount,
        nextAvailableAt: pixelAllowance.nextPixelSavedAt,
        pixelAllowance
      };
      socket.emit('canvasSnapshot', canvasSnapshot);
      if (connectionOpen) {
        await flushQueuedPlacements();
      }
      acceptsPlacements = true;
    } catch (error) {
      app.log.error({ err: error }, 'Failed to send Socket.IO canvas snapshot');
      rejectPlacement(socket, {
        reason: 'server_error',
        message: 'Unable to load canvas snapshot.'
      });
      acceptsPlacements = true;
      queuedPlacePixelPayloads.splice(0);
    }
  });

  pixelIo.broadcastPixelUpdated = (payload: PixelUpdatedPayload) => {
    io.to(canvasRoomName(payload.canvasId)).emit('pixelUpdated', payload);
  };

  pixelIo.broadcastQuickPixelPlaced = async (payload: QuickPixelResponseDto, metadata: QuickPixelRealtimeMetadata) => {
    const socketRoom = canvasRoomName(payload.canvasId);
    const pixelUpdated: PixelUpdatedPayload = {
      roomPublicId: payload.roomPublicId,
      dailyCanvasId: payload.dailyCanvasId,
      canvasId: payload.canvasId,
      x: payload.x,
      y: payload.y,
      colorHex: payload.colorHex,
      updatedAt: payload.recentEvents?.[0]?.createdAt ?? new Date().toISOString()
    };
    io.to(socketRoom).emit('pixelUpdated', pixelUpdated);

    const roomRecentEvents = await getPublicRecentEvents(app.db, payload.canvasId, RECENT_EVENT_LIMIT);
    const recentPayload: RecentEventsUpdatedPayload = {
      roomPublicId: payload.roomPublicId,
      dailyCanvasId: payload.dailyCanvasId,
      events: roomRecentEvents
    };
    io.to(socketRoom).emit('roomRecentEventsUpdated', recentPayload);

    if (payload.recentEvents) {
      const personalPayload: RecentEventsUpdatedPayload = {
        roomPublicId: payload.roomPublicId,
        dailyCanvasId: payload.dailyCanvasId,
        events: payload.recentEvents
      };
      const sockets = await io.in(socketRoom).fetchSockets();
      for (const connectedSocket of sockets) {
        if ((connectedSocket.data as Partial<RoomSocketData>).actorKey === metadata.actorKey) {
          connectedSocket.emit('myRecentEventsUpdated', personalPayload);
        }
      }
    }
  };

  app.addHook('onClose', async () => {
    await io.close();
  });

  return pixelIo;
}
