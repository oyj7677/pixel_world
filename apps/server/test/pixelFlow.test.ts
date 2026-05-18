import { DEFAULT_CANVAS_COLOR } from '@pixel-world/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import {
  getCanvasSnapshot,
  getPublicRecentEventsForActor,
  getPublicRecentEvents,
  getRecentEvents,
  upsertPixelAndLog
} from '../src/db/canvasRepository';
import { createDbPool, type DbPool } from '../src/db/index';
import { runMigrations } from '../src/db/migrate';

const TEST_CANVAS_ID = 'test-canvas-pixel-flow';

let pool: DbPool;

async function clearTestCanvas(): Promise<void> {
  await pool.query('DELETE FROM pixel_events WHERE canvas_id = $1', [TEST_CANVAS_ID]);
  await pool.query('DELETE FROM pixels WHERE canvas_id = $1', [TEST_CANVAS_ID]);
}

beforeAll(async () => {
  await runMigrations();
  pool = createDbPool(loadConfig());
  await pool.query(
    `INSERT INTO canvases (id, slug, width, height)
     VALUES ($1, $2, 100, 100)
     ON CONFLICT (id) DO UPDATE
     SET width = EXCLUDED.width,
         height = EXCLUDED.height,
         updated_at = now()`,
    [TEST_CANVAS_ID, TEST_CANVAS_ID]
  );
});

beforeEach(async () => {
  await clearTestCanvas();
});

afterAll(async () => {
  await pool.query('DELETE FROM canvases WHERE id = $1', [TEST_CANVAS_ID]);
  await pool.end();
});

describe('canvas repository', () => {
  it('stores a pixel, returns it in the snapshot, and logs public and admin events', async () => {
    const saved = await upsertPixelAndLog(pool, {
      canvasId: TEST_CANVAS_ID,
      x: 3,
      y: 4,
      colorHex: '#38BDF8',
      actorKey: 'actor-a',
      actorIpHash: 'ip-hash-a',
      source: 'user'
    });

    expect(saved.previousColorHex).toBeNull();
    expect(saved.newColorHex).toBe('#38BDF8');

    const snapshot = await getCanvasSnapshot(pool, TEST_CANVAS_ID);
    expect(snapshot.defaultColorHex).toBe(DEFAULT_CANVAS_COLOR);
    expect(snapshot.pixels).toContainEqual(
      expect.objectContaining({ x: 3, y: 4, colorHex: '#38BDF8' })
    );

    const publicEvents = await getPublicRecentEvents(pool, TEST_CANVAS_ID, 10);
    expect(publicEvents[0]).toEqual(expect.objectContaining({ x: 3, y: 4, newColorHex: '#38BDF8' }));
    expect(publicEvents[0]).not.toHaveProperty('actorKey');
    expect(publicEvents[0]).not.toHaveProperty('actorIpHash');

    const adminEvents = await getRecentEvents(pool, TEST_CANVAS_ID, 10);
    expect(adminEvents[0]).toEqual(
      expect.objectContaining({ actorKey: 'actor-a', actorIpHash: 'ip-hash-a' })
    );
  });

  it('returns the previous color when overwriting the same pixel', async () => {
    const first = await upsertPixelAndLog(pool, {
      canvasId: TEST_CANVAS_ID,
      x: 12,
      y: 13,
      colorHex: '#22C55E',
      actorKey: 'actor-a',
      actorIpHash: 'ip-hash-a',
      source: 'user'
    });

    const second = await upsertPixelAndLog(pool, {
      canvasId: TEST_CANVAS_ID,
      x: 12,
      y: 13,
      colorHex: '#8B5CF6',
      actorKey: 'actor-b',
      actorIpHash: 'ip-hash-b',
      source: 'user'
    });

    expect(first.previousColorHex).toBeNull();
    expect(first.newColorHex).toBe('#22C55E');
    expect(second.previousColorHex).toBe('#22C55E');
    expect(second.newColorHex).toBe('#8B5CF6');
  });

  it('can return public recent events filtered to one actor only', async () => {
    await upsertPixelAndLog(pool, {
      canvasId: TEST_CANVAS_ID,
      x: 20,
      y: 21,
      colorHex: '#EF4444',
      actorKey: 'actor-a',
      actorIpHash: 'ip-hash-a',
      source: 'user'
    });
    await upsertPixelAndLog(pool, {
      canvasId: TEST_CANVAS_ID,
      x: 22,
      y: 23,
      colorHex: '#38BDF8',
      actorKey: 'actor-b',
      actorIpHash: 'ip-hash-b',
      source: 'user'
    });

    const actorEvents = await getPublicRecentEventsForActor(pool, TEST_CANVAS_ID, 'actor-a', 10);

    expect(actorEvents).toEqual([
      expect.objectContaining({ x: 20, y: 21, newColorHex: '#EF4444' })
    ]);
    expect(actorEvents[0]).not.toHaveProperty('actorKey');
    expect(actorEvents[0]).not.toHaveProperty('actorIpHash');
  });

  it('serializes concurrent first writes so only one event sees an empty previous color', async () => {
    const [first, second] = await Promise.all([
      upsertPixelAndLog(pool, {
        canvasId: TEST_CANVAS_ID,
        x: 8,
        y: 9,
        colorHex: '#EF4444',
        actorKey: 'actor-a',
        actorIpHash: 'ip-hash-a',
        source: 'user'
      }),
      upsertPixelAndLog(pool, {
        canvasId: TEST_CANVAS_ID,
        x: 8,
        y: 9,
        colorHex: '#3B82F6',
        actorKey: 'actor-b',
        actorIpHash: 'ip-hash-b',
        source: 'user'
      })
    ]);

    const events = [first, second];
    const emptyPreviousEvents = events.filter((event) => event.previousColorHex === null);
    const nonEmptyPreviousEvents = events.filter((event) => event.previousColorHex !== null);

    expect(emptyPreviousEvents).toHaveLength(1);
    expect(nonEmptyPreviousEvents).toHaveLength(1);

    const [emptyPreviousEvent] = emptyPreviousEvents;
    const [nonEmptyPreviousEvent] = nonEmptyPreviousEvents;
    expect(nonEmptyPreviousEvent?.previousColorHex).toBe(emptyPreviousEvent?.newColorHex);
  });
});
