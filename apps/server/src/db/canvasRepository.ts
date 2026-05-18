import {
  DEFAULT_CANVAS_COLOR,
  type HexColor,
  type PixelRecord,
  type PublicRecentPixelEvent,
  type RecentPixelEvent
} from '@pixel-world/shared';
import type { DbClient } from './index';

interface UpsertPixelInput {
  canvasId: string;
  x: number;
  y: number;
  colorHex: HexColor;
  actorKey: string;
  actorIpHash: string;
  source: 'user' | 'admin';
}

export interface LoggedPixelEvent extends RecentPixelEvent {
  canvasId: string;
}

export type { PublicRecentPixelEvent };

function mapPixel(row: { x: number; y: number; color_hex: string; updated_at: Date }): PixelRecord {
  return {
    x: row.x,
    y: row.y,
    colorHex: row.color_hex as HexColor,
    updatedAt: row.updated_at.toISOString()
  };
}

function mapEvent(row: {
  id: string;
  canvas_id: string;
  x: number;
  y: number;
  previous_color_hex: string | null;
  new_color_hex: string;
  actor_key: string;
  actor_ip_hash: string;
  source: 'user' | 'admin';
  created_at: Date;
}): LoggedPixelEvent {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    x: row.x,
    y: row.y,
    previousColorHex: row.previous_color_hex as HexColor | null,
    newColorHex: row.new_color_hex as HexColor,
    actorKey: row.actor_key,
    actorIpHash: row.actor_ip_hash,
    source: row.source,
    createdAt: row.created_at.toISOString()
  };
}

function toPublicEvent(event: RecentPixelEvent): PublicRecentPixelEvent {
  return {
    id: event.id,
    x: event.x,
    y: event.y,
    previousColorHex: event.previousColorHex,
    newColorHex: event.newColorHex,
    source: event.source,
    createdAt: event.createdAt
  };
}

function pixelLockKey(canvasId: string, x: number, y: number): string {
  return `${canvasId}:${x}:${y}`;
}

export async function getCanvasSnapshot(db: DbClient, canvasId: string) {
  const canvasResult = await db.query(
    'SELECT id, width, height FROM canvases WHERE id = $1',
    [canvasId]
  );

  const canvas = canvasResult.rows[0];
  if (!canvas) {
    throw new Error(`Canvas not found: ${canvasId}`);
  }

  const pixelsResult = await db.query(
    'SELECT x, y, color_hex, updated_at FROM pixels WHERE canvas_id = $1 ORDER BY y ASC, x ASC',
    [canvasId]
  );

  return {
    canvasId: canvas.id as string,
    width: Number(canvas.width),
    height: Number(canvas.height),
    defaultColorHex: DEFAULT_CANVAS_COLOR,
    pixels: pixelsResult.rows.map(mapPixel)
  };
}

export async function getRecentEvents(
  db: DbClient,
  canvasId: string,
  limit: number
): Promise<RecentPixelEvent[]> {
  const result = await db.query(
    `SELECT id, canvas_id, x, y, previous_color_hex, new_color_hex, actor_key, actor_ip_hash, source, created_at
     FROM pixel_events
     WHERE canvas_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [canvasId, limit]
  );

  return result.rows.map(mapEvent);
}

export async function getPublicRecentEvents(
  db: DbClient,
  canvasId: string,
  limit: number
): Promise<PublicRecentPixelEvent[]> {
  const events = await getRecentEvents(db, canvasId, limit);
  return events.map(toPublicEvent);
}

export async function getRecentEventsForActor(
  db: DbClient,
  canvasId: string,
  actorKey: string,
  limit: number
): Promise<RecentPixelEvent[]> {
  const result = await db.query(
    `SELECT id, canvas_id, x, y, previous_color_hex, new_color_hex, actor_key, actor_ip_hash, source, created_at
     FROM pixel_events
     WHERE canvas_id = $1
       AND actor_key = $2
       AND source = 'user'
     ORDER BY created_at DESC
     LIMIT $3`,
    [canvasId, actorKey, limit]
  );

  return result.rows.map(mapEvent);
}

export async function getPublicRecentEventsForActor(
  db: DbClient,
  canvasId: string,
  actorKey: string,
  limit: number
): Promise<PublicRecentPixelEvent[]> {
  const events = await getRecentEventsForActor(db, canvasId, actorKey, limit);
  return events.map(toPublicEvent);
}

export async function upsertPixelAndLog(
  db: DbClient,
  input: UpsertPixelInput
): Promise<LoggedPixelEvent> {
  const client = 'connect' in db ? await db.connect() : db;
  const shouldRelease = 'connect' in db;

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      pixelLockKey(input.canvasId, input.x, input.y)
    ]);

    const previousResult = await client.query(
      `SELECT color_hex
       FROM pixels
       WHERE canvas_id = $1 AND x = $2 AND y = $3
       FOR UPDATE`,
      [input.canvasId, input.x, input.y]
    );
    const previousColorHex = previousResult.rows[0]?.color_hex ?? null;

    await client.query(
      `INSERT INTO pixels (canvas_id, x, y, color_hex, last_actor_key, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (canvas_id, x, y)
       DO UPDATE SET color_hex = EXCLUDED.color_hex,
                     last_actor_key = EXCLUDED.last_actor_key,
                     updated_at = now()`,
      [input.canvasId, input.x, input.y, input.colorHex, input.actorKey]
    );

    const eventResult = await client.query(
      `INSERT INTO pixel_events
       (canvas_id, x, y, previous_color_hex, new_color_hex, actor_key, actor_ip_hash, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, canvas_id, x, y, previous_color_hex, new_color_hex, actor_key, actor_ip_hash, source, created_at`,
      [
        input.canvasId,
        input.x,
        input.y,
        previousColorHex,
        input.colorHex,
        input.actorKey,
        input.actorIpHash,
        input.source
      ]
    );

    await client.query('COMMIT');
    return mapEvent(eventResult.rows[0]) as LoggedPixelEvent;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (shouldRelease) {
      (client as unknown as { release: () => void }).release();
    }
  }
}


export async function insertPixelIfEmptyAndLog(
  db: DbClient,
  input: UpsertPixelInput
): Promise<LoggedPixelEvent | null> {
  const eventResult = await db.query(
    `WITH inserted_pixel AS (
       INSERT INTO pixels (canvas_id, x, y, color_hex, last_actor_key, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (canvas_id, x, y) DO NOTHING
       RETURNING canvas_id, x, y
     )
     INSERT INTO pixel_events
       (canvas_id, x, y, previous_color_hex, new_color_hex, actor_key, actor_ip_hash, source)
     SELECT canvas_id, x, y, NULL, $4, $5, $6, $7
     FROM inserted_pixel
     RETURNING id, canvas_id, x, y, previous_color_hex, new_color_hex, actor_key, actor_ip_hash, source, created_at`,
    [
      input.canvasId,
      input.x,
      input.y,
      input.colorHex,
      input.actorKey,
      input.actorIpHash,
      input.source
    ]
  );

  const event = eventResult.rows[0];
  return event ? (mapEvent(event) as LoggedPixelEvent) : null;
}

export async function logAdminAction(
  db: DbClient,
  actionType: string,
  targetSummary: string,
  metadata: Record<string, unknown>,
  scope: { scopeType?: 'global' | 'room' | 'daily_canvas' | 'canvas'; roomId?: string | null; dailyCanvasId?: string | null; canvasId?: string | null } = {}
): Promise<void> {
  await db.query(
    `INSERT INTO admin_actions (action_type, target_summary, metadata, scope_type, room_id, daily_canvas_id, canvas_id)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
    [
      actionType,
      targetSummary,
      JSON.stringify(metadata),
      scope.scopeType ?? null,
      scope.roomId ?? null,
      scope.dailyCanvasId ?? null,
      scope.canvasId ?? null
    ]
  );
}


export async function isActorBlocked(
  db: DbClient,
  input: {
    actorKey: string;
    actorIpHash: string;
    roomId?: string | null;
    dailyCanvasId?: string | null;
    canvasId?: string | null;
  }
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1
     FROM blocks
     WHERE expires_at > now()
       AND (actor_key = $1 OR actor_ip_hash = $2)
       AND (
         scope_type = 'global'
         OR (scope_type = 'room' AND room_id = $3::uuid)
         OR (scope_type = 'daily_canvas' AND daily_canvas_id = $4::uuid)
         OR (scope_type = 'canvas' AND canvas_id = $5)
       )
     LIMIT 1`,
    [input.actorKey, input.actorIpHash, input.roomId ?? null, input.dailyCanvasId ?? null, input.canvasId ?? null]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function createBlock(
  db: DbClient,
  input: {
    actorKey?: string;
    actorIpHash?: string;
    reason: string;
    expiresAt: Date;
    scopeType?: 'global' | 'room' | 'daily_canvas' | 'canvas';
    roomId?: string | null;
    dailyCanvasId?: string | null;
    canvasId?: string | null;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO blocks (actor_key, actor_ip_hash, reason, expires_at, scope_type, room_id, daily_canvas_id, canvas_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.actorKey ?? null,
      input.actorIpHash ?? null,
      input.reason,
      input.expiresAt,
      input.scopeType ?? 'global',
      input.roomId ?? null,
      input.dailyCanvasId ?? null,
      input.canvasId ?? null
    ]
  );
}
