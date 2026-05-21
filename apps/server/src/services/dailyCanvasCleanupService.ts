import type { FastifyInstance } from 'fastify';
import { deleteExpiredDailyCanvasData } from '../rooms/roomRepository';

const KOREA_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TIMER_DELAY_MS = 1_000;

export function millisecondsUntilNextKoreanMidnight(now = new Date()): number {
  const koreanNowMs = now.getTime() + KOREA_UTC_OFFSET_MS;
  const nextKoreanMidnightMs = (Math.floor(koreanNowMs / DAY_MS) + 1) * DAY_MS;
  return Math.max(MIN_TIMER_DELAY_MS, nextKoreanMidnightMs - koreanNowMs);
}

export async function deleteExpiredDailyCanvasDataOnce(
  app: FastifyInstance,
  reason: 'startup' | 'scheduled' = 'scheduled',
): Promise<void> {
  const result = await deleteExpiredDailyCanvasData(app.db);

  if (result.dailyCanvasCount === 0) {
    app.log.debug({ reason }, 'No expired daily canvas data to delete');
    return;
  }

  app.log.info(
    {
      reason,
      dailyCanvasCount: result.dailyCanvasCount,
      canvasCount: result.canvasCount,
      pixelCount: result.pixelCount,
      pixelEventCount: result.pixelEventCount,
    },
    'Deleted expired daily canvas data',
  );
}

export function startDailyCanvasCleanupSchedule(app: FastifyInstance): void {
  let stopped = false;
  let timeout: NodeJS.Timeout | null = null;

  const scheduleNext = () => {
    if (stopped) {
      return;
    }

    timeout = setTimeout(async () => {
      try {
        await deleteExpiredDailyCanvasDataOnce(app, 'scheduled');
      } catch (error) {
        app.log.error({ err: error }, 'Failed to delete expired daily canvas data');
      } finally {
        scheduleNext();
      }
    }, millisecondsUntilNextKoreanMidnight());
    timeout.unref?.();
  };

  void deleteExpiredDailyCanvasDataOnce(app, 'startup').catch((error) => {
    app.log.error({ err: error }, 'Failed to delete expired daily canvas data on startup');
  });
  scheduleNext();

  app.addHook('onClose', (_instance, done) => {
    stopped = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    done();
  });
}
