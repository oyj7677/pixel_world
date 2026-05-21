'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CANVAS_COLOR,
  DEFAULT_PALETTE,
  FRIEND_ROOM_ROUTES,
  type CanvasSnapshotPayload,
  type CooldownUpdatedPayload,
  type HexColor,
  type PixelAllowanceStatePayload,
  type PixelRecord,
  type PixelUpdatedPayload,
  type PlacementRejectedPayload,
  type PresenceUpdatedPayload,
  normalizeInviteCode
} from '@pixel-world/shared';
import { CanvasBoard } from './CanvasBoard';
import { ColorTools } from './ColorTools';
import { StatusBar } from './StatusBar';
import { downloadCanvasImage } from '../lib/canvasImageDownload';
import { createRoomInvite, getRoomToday, type InviteCredential, type RoomTodayResponseDto } from '../lib/roomApi';
import { createPixelSocket, type PixelSocket } from '../lib/socketClient';

interface RoomCanvasShellProps {
  roomPublicId: string;
  inviteToken?: string | undefined;
  inviteCode?: string | undefined;
}

function buildInviteCredential(inviteToken?: string, inviteCode?: string): InviteCredential | undefined {
  if (inviteToken) {
    return { inviteToken };
  }
  if (inviteCode) {
    return { inviteCode };
  }
  return undefined;
}

function normalizeVisibleInviteCode(inviteCode?: string): string {
  return inviteCode ? normalizeInviteCode(inviteCode) ?? '' : '';
}

function buildInviteCodeUrl(inviteCode: string): string {
  const inviteCodePath = FRIEND_ROOM_ROUTES.inviteCode(inviteCode);
  if (typeof window === 'undefined') {
    return inviteCodePath;
  }

  return new URL(inviteCodePath, window.location.origin).toString();
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

export function RoomCanvasShell({ roomPublicId, inviteToken, inviteCode }: RoomCanvasShellProps) {
  const [today, setToday] = useState<RoomTodayResponseDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedColor, setSelectedColor] = useState<HexColor>(DEFAULT_PALETTE[9]!);
  const [eyedropperColor, setEyedropperColor] = useState<HexColor | null>(null);
  const [pixels, setPixels] = useState<PixelRecord[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [cooldownDeadlineMs, setCooldownDeadlineMs] = useState<number | null>(null);
  const [pixelAllowance, setPixelAllowance] = useState<PixelAllowanceStatePayload | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const [defaultColorHex, setDefaultColorHex] = useState<HexColor>(DEFAULT_CANVAS_COLOR);
  const [visibleInviteCode, setVisibleInviteCode] = useState(() => normalizeVisibleInviteCode(inviteCode));
  const [isPreparingInviteCode, setIsPreparingInviteCode] = useState(false);
  const [inviteCodeProvisionFailed, setInviteCodeProvisionFailed] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const [snackbarError, setSnackbarError] = useState<string | null>(null);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const socketRef = useRef<PixelSocket | null>(null);
  const pixelAllowanceRef = useRef<PixelAllowanceStatePayload | null>(null);
  const todayRef = useRef<RoomTodayResponseDto | null>(null);

  useEffect(() => {
    const normalizedInviteCode = normalizeVisibleInviteCode(inviteCode);
    if (normalizedInviteCode) {
      setVisibleInviteCode(normalizedInviteCode);
      setInviteCodeProvisionFailed(false);
    }
  }, [inviteCode]);

  useEffect(() => {
    if (!snackbarMessage && !snackbarError) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSnackbarMessage(null);
      setSnackbarError(null);
    }, 2800);

    return () => window.clearTimeout(timeoutId);
  }, [snackbarError, snackbarMessage]);

  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  useEffect(() => {
    pixelAllowanceRef.current = pixelAllowance;
  }, [pixelAllowance]);

  useEffect(() => {
    if (!today || visibleInviteCode || inviteCodeProvisionFailed || isCreatingInvite) {
      return;
    }

    let cancelled = false;
    setIsPreparingInviteCode(true);

    createRoomInvite(roomPublicId, buildInviteCredential(inviteToken, inviteCode))
      .then((response) => {
        if (cancelled) {
          return;
        }

        setVisibleInviteCode(response.inviteCode);
        setInviteCodeProvisionFailed(false);
      })
      .catch(() => {
        if (!cancelled) {
          setInviteCodeProvisionFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsPreparingInviteCode(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [inviteCode, inviteCodeProvisionFailed, inviteToken, isCreatingInvite, roomPublicId, today, visibleInviteCode]);

  useEffect(() => {
    let cancelled = false;
    let socket: PixelSocket | null = null;

    const inviteCredential = buildInviteCredential(inviteToken, inviteCode);

    void getRoomToday(roomPublicId, inviteCredential)
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
          date: 'today',
          ...inviteCredential
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
  }, [inviteCode, inviteToken, roomPublicId]);

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

  const handleDownloadCanvasImage = useCallback(async () => {
    setSnackbarMessage(null);
    setSnackbarError(null);

    try {
      await downloadCanvasImage({
        width: canvasWidth,
        height: canvasHeight,
        defaultColorHex,
        pixels,
      }, { roomName: today?.roomName ?? 'pixel-world' });
      setSnackbarMessage('캔버스 작품 이미지를 저장했어요.');
    } catch {
      setSnackbarError('캔버스 작품 이미지를 저장하지 못했어요. 브라우저 설정을 확인해 주세요.');
    }
  }, [canvasHeight, canvasWidth, defaultColorHex, pixels, today?.roomName]);

  const handleCopyInvite = useCallback(async () => {
    if (isCreatingInvite) {
      return;
    }

    setIsCreatingInvite(true);
    setInviteCodeProvisionFailed(false);
    setSnackbarMessage(null);
    setSnackbarError(null);

    try {
      let inviteCodeToCopy = visibleInviteCode;

      if (!inviteCodeToCopy) {
        const response = await createRoomInvite(roomPublicId, buildInviteCredential(inviteToken, inviteCode));
        inviteCodeToCopy = response.inviteCode;
        setVisibleInviteCode(response.inviteCode);
      }

      if (!navigator.clipboard?.writeText) {
        setSnackbarError('브라우저가 복사를 막았어요. 입장 코드를 친구에게 알려주세요.');
        return;
      }

      await navigator.clipboard.writeText(buildInviteCodeUrl(inviteCodeToCopy));
      setSnackbarMessage('초대 주소를 복사했어요.');
    } catch {
      setSnackbarError('초대 주소를 복사하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsCreatingInvite(false);
    }
  }, [inviteCode, inviteToken, isCreatingInvite, roomPublicId, visibleInviteCode]);

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
          <div className="room-invite-code-card" aria-label="4자리 입장 코드">
            <span>입장 코드</span>
            {visibleInviteCode ? (
              <strong>{visibleInviteCode}</strong>
            ) : (
              <em>{isPreparingInviteCode ? '준비 중…' : '복사하면 생성돼요'}</em>
            )}
          </div>
          <button
            className="ghost-action"
            type="button"
            onClick={handleCopyInvite}
            disabled={isCreatingInvite || (isPreparingInviteCode && !visibleInviteCode)}
          >
            {isCreatingInvite ? '초대 주소 복사 중…' : '초대 주소 복사'}
          </button>
        </div>
      </header>

      {snackbarMessage ? (
        <p className="snackbar" role="status" aria-live="polite">
          {snackbarMessage}
        </p>
      ) : null}
      {snackbarError ? (
        <p className="snackbar snackbar--error" role="alert">
          {snackbarError}
        </p>
      ) : null}

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
          <section className="panel canvas-art-download" aria-label="캔버스 작품 이미지 저장">
            <h2>작품 저장</h2>
            <p>
              현재 {canvasWidth}×{canvasHeight} 캔버스 전체 작품을 격자선 없는 PNG로 저장해요.
            </p>
            <button
              className="secondary-link"
              type="button"
              onClick={handleDownloadCanvasImage}
            >
              작품 이미지 저장
            </button>
          </section>
          <section aria-label="방 직접 칠하기 도구">
            <ColorTools selectedColor={selectedColor} eyedropperColor={eyedropperColor} onColorChange={setSelectedColor} />
          </section>
        </aside>
      </div>
    </main>
  );
}
