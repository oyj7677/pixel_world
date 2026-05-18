'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CANVAS_COLOR,
  DEFAULT_PALETTE,
  type CanvasSnapshotPayload,
  type CooldownUpdatedPayload,
  type HexColor,
  type PixelAllowanceStatePayload,
  type PixelRecord,
  type PixelUpdatedPayload,
  type PlacementRejectedPayload,
  type PresenceUpdatedPayload,
  type PublicRecentPixelEvent,
  type RecentEventsUpdatedPayload
} from '@pixel-world/shared';
import { CanvasBoard } from './CanvasBoard';
import { ColorTools } from './ColorTools';
import { RecentEvents } from './RecentEvents';
import { StatusBar } from './StatusBar';
import { createRoomInvite, getRoomToday, type RoomTodayResponseDto } from '../lib/roomApi';
import { createPixelSocket, type PixelSocket } from '../lib/socketClient';

interface RoomCanvasShellProps {
  roomPublicId: string;
}

function deadlineFromTimestamp(timestamp: unknown) {
  if (typeof timestamp !== 'string') {
    return null;
  }

  const nextTime = new Date(timestamp).getTime();
  return Number.isFinite(nextTime) ? nextTime : null;
}

function remainingFromDeadline(deadlineMs: number | null) {
  return deadlineMs === null ? 0 : Math.max(0, deadlineMs - Date.now());
}

function accrueSavedPixels(allowance: PixelAllowanceStatePayload, nowMs = Date.now()): PixelAllowanceStatePayload {
  if (allowance.savedPixelCount >= allowance.maxSavedPixelCount) {
    return allowance;
  }

  const nextSavedMs = deadlineFromTimestamp(allowance.nextPixelSavedAt);
  const intervalMs = allowance.dynamicAllowanceIntervalMs;

  if (nextSavedMs === null || intervalMs <= 0 || nextSavedMs > nowMs) {
    return allowance;
  }

  const elapsedIntervals = Math.floor((nowMs - nextSavedMs) / intervalMs) + 1;
  const savedPixelCount = Math.min(allowance.maxSavedPixelCount, allowance.savedPixelCount + elapsedIntervals);

  return {
    ...allowance,
    savedPixelCount,
    nextPixelSavedAt: new Date(nextSavedMs + elapsedIntervals * intervalMs).toISOString()
  };
}

function nextAllowanceDeadline(allowance: PixelAllowanceStatePayload | null) {
  if (allowance === null || allowance.savedPixelCount >= allowance.maxSavedPixelCount) {
    return null;
  }

  return deadlineFromTimestamp(allowance.nextPixelSavedAt);
}

function mergePixel(pixels: PixelRecord[], update: PixelRecord) {
  let replaced = false;
  const nextPixels = pixels.map((pixel) => {
    if (pixel.x === update.x && pixel.y === update.y) {
      replaced = true;
      return update;
    }

    return pixel;
  });

  if (!replaced) {
    nextPixels.push(update);
  }

  return nextPixels;
}

function isForRoom(today: RoomTodayResponseDto | null, payload: { roomPublicId?: string; dailyCanvasId?: string }) {
  return Boolean(
    today &&
      payload.roomPublicId === today.roomPublicId &&
      (!payload.dailyCanvasId || payload.dailyCanvasId === today.todayDailyCanvasId)
  );
}

export function RoomCanvasShell({ roomPublicId }: RoomCanvasShellProps) {
  const [today, setToday] = useState<RoomTodayResponseDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedColor, setSelectedColor] = useState<HexColor>(DEFAULT_PALETTE[9]!);
  const [eyedropperColor, setEyedropperColor] = useState<HexColor | null>(null);
  const [pixels, setPixels] = useState<PixelRecord[]>([]);
  const [myRecentEvents, setMyRecentEvents] = useState<PublicRecentPixelEvent[]>([]);
  const [roomRecentEvents, setRoomRecentEvents] = useState<PublicRecentPixelEvent[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [cooldownDeadlineMs, setCooldownDeadlineMs] = useState<number | null>(null);
  const [pixelAllowance, setPixelAllowance] = useState<PixelAllowanceStatePayload | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const [defaultColorHex, setDefaultColorHex] = useState<HexColor>(DEFAULT_CANVAS_COLOR);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteShareMessage, setInviteShareMessage] = useState<string | null>(null);
  const [inviteShareError, setInviteShareError] = useState<string | null>(null);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const socketRef = useRef<PixelSocket | null>(null);
  const pixelAllowanceRef = useRef<PixelAllowanceStatePayload | null>(null);
  const todayRef = useRef<RoomTodayResponseDto | null>(null);

  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  useEffect(() => {
    pixelAllowanceRef.current = pixelAllowance;
  }, [pixelAllowance]);

  useEffect(() => {
    let cancelled = false;
    let socket: PixelSocket | null = null;

    void getRoomToday(roomPublicId)
      .then((roomToday) => {
        if (cancelled) {
          return;
        }
        if (!roomToday) {
          setNotFound(true);
          return;
        }

        setToday(roomToday);
        todayRef.current = roomToday;
        setCanvasWidth(roomToday.canvasSize.width);
        setCanvasHeight(roomToday.canvasSize.height);

        socket = createPixelSocket({
          roomPublicId: roomToday.roomPublicId,
          dailyCanvasId: roomToday.todayDailyCanvasId,
          date: 'today'
        });
        socketRef.current = socket;

        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => {
          setConnected(false);
          setHasSnapshot(false);
        });
        socket.on('canvasSnapshot', (snapshot: CanvasSnapshotPayload) => {
          if (!isForRoom(todayRef.current, snapshot)) {
            return;
          }

          setHasSnapshot(true);
          setCanvasWidth(snapshot.width);
          setCanvasHeight(snapshot.height);
          setDefaultColorHex(snapshot.defaultColorHex);
          setPixels(snapshot.pixels);
          setMyRecentEvents(snapshot.recentEvents);
          setRoomRecentEvents(snapshot.roomRecentEvents ?? []);
          setOnlineCount(snapshot.onlineCount);
          pixelAllowanceRef.current = snapshot.pixelAllowance;
          setPixelAllowance(snapshot.pixelAllowance);
          const nextDeadlineMs = nextAllowanceDeadline(snapshot.pixelAllowance);
          setCooldownDeadlineMs(nextDeadlineMs);
          setRemainingMs(remainingFromDeadline(nextDeadlineMs));
        });
        socket.on('pixelUpdated', (pixel: PixelUpdatedPayload) => {
          const currentToday = todayRef.current;
          if (!currentToday || pixel.canvasId !== currentToday.canvasId || !isForRoom(currentToday, pixel)) {
            return;
          }

          setPixels((currentPixels) => mergePixel(currentPixels, pixel));
        });
        socket.on('presenceUpdated', ({ onlineCount: nextOnlineCount }: PresenceUpdatedPayload) => {
          setOnlineCount(nextOnlineCount);
        });
        socket.on('roomRecentEventsUpdated', (update: RecentEventsUpdatedPayload) => {
          if (isForRoom(todayRef.current, update)) {
            setRoomRecentEvents(update.events);
          }
        });
        socket.on('myRecentEventsUpdated', (update: RecentEventsUpdatedPayload) => {
          if (isForRoom(todayRef.current, update)) {
            setMyRecentEvents(update.events);
          }
        });
        socket.on('cooldownUpdated', (update: CooldownUpdatedPayload) => {
          pixelAllowanceRef.current = update;
          setPixelAllowance(update);
          const nextDeadlineMs = nextAllowanceDeadline(update);
          setCooldownDeadlineMs(nextDeadlineMs);
          setRemainingMs(remainingFromDeadline(nextDeadlineMs));
        });
        socket.on('placementRejected', ({ remainingMs: nextRemainingMs }: PlacementRejectedPayload) => {
          if (typeof nextRemainingMs === 'number') {
            const nextDeadlineMs = Date.now() + Math.max(0, nextRemainingMs);
            setCooldownDeadlineMs(nextDeadlineMs);
            setRemainingMs(remainingFromDeadline(nextDeadlineMs));
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setNotFound(true);
        }
      });

    return () => {
      cancelled = true;
      socketRef.current = null;
      socket?.disconnect();
    };
  }, [roomPublicId]);

  useEffect(() => {
    if (cooldownDeadlineMs === null) {
      setRemainingMs(0);
      return;
    }

    const updateRemainingMs = () => {
      const nextRemainingMs = remainingFromDeadline(cooldownDeadlineMs);
      setRemainingMs(nextRemainingMs);

      if (nextRemainingMs === 0) {
        const nextAllowance = pixelAllowanceRef.current ? accrueSavedPixels(pixelAllowanceRef.current) : null;
        pixelAllowanceRef.current = nextAllowance;
        setPixelAllowance(nextAllowance);
        setCooldownDeadlineMs(nextAllowanceDeadline(nextAllowance));
      }
    };

    updateRemainingMs();
    const intervalId = window.setInterval(updateRemainingMs, 1000);

    return () => window.clearInterval(intervalId);
  }, [cooldownDeadlineMs]);

  const handlePlacePixel = useCallback(
    (x: number, y: number) => {
      if (!today) {
        return;
      }

      socketRef.current?.emit('placePixel', {
        roomPublicId: today.roomPublicId,
        dailyCanvasId: today.todayDailyCanvasId,
        canvasId: today.canvasId,
        x,
        y,
        colorHex: selectedColor
      });
    },
    [selectedColor, today]
  );

  const handleCopyInvite = useCallback(async () => {
    if (isCreatingInvite) {
      return;
    }

    setIsCreatingInvite(true);
    setInviteShareMessage(null);
    setInviteShareError(null);

    try {
      const response = await createRoomInvite(roomPublicId);
      setInviteUrl(response.inviteUrl);

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(response.inviteUrl);
          setInviteShareMessage('초대 주소를 복사했어요. 친구에게 바로 보내면 됩니다.');
        } else {
          setInviteShareMessage('초대 주소를 만들었어요. 아래 주소를 직접 복사해 주세요.');
        }
      } catch {
        setInviteShareMessage('초대 주소를 만들었어요. 아래 주소를 직접 복사해 주세요.');
      }
    } catch {
      setInviteShareError('초대 주소를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsCreatingInvite(false);
    }
  }, [isCreatingInvite, roomPublicId]);

  if (notFound) {
    return (
      <main className="page-shell invite-shell">
        <section className="panel invite-card" aria-labelledby="room-not-found-heading">
          <p className="eyebrow">친구 방</p>
          <h1 id="room-not-found-heading">방을 열 수 없습니다</h1>
          <p className="friend-room-copy">오늘은 이 방을 열 수 없습니다.</p>
        </section>
      </main>
    );
  }

  if (!today || !hasSnapshot) {
    return (
      <main className="page-shell">
        <section className="panel canvas-placeholder" role="status" aria-live="polite">
          방 캔버스를 불러오는 중…
        </section>
      </main>
    );
  }

  const canPlacePixel = connected && pixelAllowance !== null && pixelAllowance.savedPixelCount > 0;

  return (
    <main className="page-shell">
      <header className="header">
        <div className="brand">
          <strong>{today.roomName ?? '친구 방'}</strong>
          <span>오늘의 방 캔버스</span>
        </div>
        <div className="room-invite-share" aria-live="polite">
          <button className="ghost-action" type="button" onClick={handleCopyInvite} disabled={isCreatingInvite}>
            {isCreatingInvite ? '초대 주소 만드는 중…' : '초대 주소 복사'}
          </button>
          {inviteShareMessage ? <p className="form-message">{inviteShareMessage}</p> : null}
          {inviteShareError ? (
            <p className="form-message form-message--error" role="alert">
              {inviteShareError}
            </p>
          ) : null}
          {inviteUrl ? <a href={inviteUrl}>{inviteUrl}</a> : null}
        </div>
      </header>

      <div className="main-grid">
        <section className="panel canvas-board-panel" aria-label="방 캔버스">
          <CanvasBoard
            width={canvasWidth}
            height={canvasHeight}
            pixels={pixels}
            defaultColorHex={defaultColorHex}
            selectedColor={selectedColor}
            canPlacePixel={canPlacePixel}
            onInspectPixel={setEyedropperColor}
            onPlacePixel={handlePlacePixel}
          />
        </section>

        <aside className="side-stack" aria-label="방 캔버스 도구">
          <StatusBar onlineCount={onlineCount} remainingMs={remainingMs} connected={connected} allowance={pixelAllowance} />
          <section aria-label="방 직접 칠하기 도구">
            <ColorTools selectedColor={selectedColor} eyedropperColor={eyedropperColor} onColorChange={setSelectedColor} />
          </section>
          <RecentEvents events={roomRecentEvents} title="방 최근 활동" ariaLabel="방 최근 픽셀 변경" />
          <RecentEvents events={myRecentEvents} />
        </aside>
      </div>
    </main>
  );
}
