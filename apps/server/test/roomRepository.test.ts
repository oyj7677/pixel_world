import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_CANVAS_ID } from '@pixel-world/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createDbPool, type DbPool } from '../src/db/index';
import { runMigrations } from '../src/db/migrate';
import {
  consumeInviteUse,
  createInvite,
  createRoomWithTodayCanvas,
  ensureRoomToday,
  ensureRoomMember,
  getRoomToday,
  revokeInvite,
  validateInvite,
  validateInviteByCode
} from '../src/rooms/roomRepository';

const INVITE_SECRET = 'room-repository-test-invite-secret';
const TEST_PREFIX = `room-repository-test-${process.pid}`;

let pool: DbPool;

async function runFriendRoomMigration(): Promise<void> {
  const sql = await readFile(join(process.cwd(), 'migrations/002_friend_rooms.sql'), 'utf8');
  await pool.query(sql);
}

async function cleanupRoomRepositoryTestData(): Promise<void> {
  await pool.query(
    `DELETE FROM analytics_events
     WHERE room_public_id LIKE $1 OR actor_key LIKE $1`,
    [`${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM room_invite_uses
     WHERE actor_key LIKE $1
        OR room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key LIKE $1)`,
    [`${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM room_pixel_allowances
     WHERE actor_key LIKE $1
        OR room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key LIKE $1)`,
    [`${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM room_invites
     WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key LIKE $1)`,
    [`${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM room_members
     WHERE actor_key LIKE $1
        OR room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key LIKE $1)`,
    [`${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM daily_canvases
     WHERE room_id IN (SELECT id FROM rooms WHERE public_id LIKE $1 OR owner_actor_key LIKE $1)`,
    [`${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM canvases
     WHERE slug LIKE $1 OR id LIKE $1`,
    [`room_${TEST_PREFIX}%`]
  );
  await pool.query(
    `DELETE FROM rooms
     WHERE public_id LIKE $1 OR owner_actor_key LIKE $1`,
    [`${TEST_PREFIX}%`]
  );
}

function actorKey(suffix: string): string {
  return `${TEST_PREFIX}-${suffix}`;
}

beforeAll(async () => {
  await runMigrations();
  pool = createDbPool(loadConfig());
  await runFriendRoomMigration();
});

beforeEach(async () => {
  await cleanupRoomRepositoryTestData();
});

afterAll(async () => {
  await cleanupRoomRepositoryTestData();
  await pool.end();
});

describe('room repository', () => {
  it('creates a private room with owner membership, invite, canvas, and today daily canvas', async () => {
    const created = await createRoomWithTodayCanvas(pool, {
      name: 'Room Repository Test Room',
      ownerActorKey: actorKey('owner'),
      publicIdPrefix: TEST_PREFIX,
      inviteSecret: INVITE_SECRET,
      today: new Date('2026-05-17T03:30:00.000Z')
    });

    expect(created.room).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        publicId: expect.stringMatching(new RegExp(`^${TEST_PREFIX}`)),
        name: 'Room Repository Test Room',
        privacy: 'private',
        ownerActorKey: actorKey('owner'),
        defaultWidth: 48,
        defaultHeight: 48
      })
    );
    expect(created.ownerMember).toEqual(
      expect.objectContaining({ roomId: created.room.id, actorKey: actorKey('owner'), role: 'owner', state: 'active' })
    );
    expect(created.invite).toEqual(
      expect.objectContaining({ roomId: created.room.id, rawToken: expect.any(String), rawCode: expect.any(String), roleOnJoin: 'guest' })
    );
    expect(created.invite.rawToken).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(created.invite.rawCode).toMatch(/^[A-Z0-9]{4}$/);
    expect(created.invite).not.toHaveProperty('codeHash');
    expect(created.dailyCanvas).toEqual(
      expect.objectContaining({ roomId: created.room.id, canvasId: created.canvas.id, status: 'active', width: 48, height: 48 })
    );
    expect(created.canvas).toEqual(
      expect.objectContaining({ id: created.dailyCanvas.canvasId, width: 48, height: 48, kind: 'room_daily' })
    );

    const rowCounts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM room_members WHERE room_id = $1 AND actor_key = $2 AND role = 'owner') AS owner_members,
         (SELECT count(*)::int FROM room_invites WHERE room_id = $1) AS invites,
         (SELECT count(*)::int FROM daily_canvases WHERE room_id = $1 AND canvas_id = $3 AND status = 'active') AS daily_canvases,
         (SELECT count(*)::int FROM canvases WHERE id = $3 AND kind = 'room_daily') AS canvases`,
      [created.room.id, actorKey('owner'), created.canvas.id]
    );

    expect(rowCounts.rows[0]).toEqual({ owner_members: 1, invites: 1, daily_canvases: 1, canvases: 1 });
  });

  it('creates square room canvases from the requested dimension', async () => {
    const created = await createRoomWithTodayCanvas(pool, {
      name: 'Room Repository Custom Size Test Room',
      ownerActorKey: actorKey('custom-size-owner'),
      publicIdPrefix: TEST_PREFIX,
      inviteSecret: INVITE_SECRET,
      canvasDimension: 64,
    });

    expect(created.room).toEqual(expect.objectContaining({
      defaultWidth: 64,
      defaultHeight: 64,
    }));
    expect(created.dailyCanvas).toEqual(expect.objectContaining({
      width: 64,
      height: 64,
      requiredPixelCount: 4096,
    }));
    expect(created.canvas).toEqual(expect.objectContaining({
      width: 64,
      height: 64,
    }));
  });

  it('stores only invite token and short-code hashes', async () => {
    const created = await createRoomWithTodayCanvas(pool, {
      name: 'Room Repository Invite Hash Test',
      ownerActorKey: actorKey('hash-owner'),
      publicIdPrefix: TEST_PREFIX,
      inviteSecret: INVITE_SECRET
    });

    const inviteRows = await pool.query('SELECT code_hash, short_code_hash FROM room_invites WHERE id = $1', [created.invite.id]);

    expect(inviteRows.rows[0].code_hash).toHaveLength(64);
    expect(inviteRows.rows[0].short_code_hash).toHaveLength(64);
    expect(inviteRows.rows[0].code_hash).not.toContain(created.invite.rawToken);
    expect(inviteRows.rows[0].code_hash).not.toBe(created.invite.rawToken);
    expect(inviteRows.rows[0].short_code_hash).not.toContain(created.invite.rawCode);
    expect(inviteRows.rows[0].short_code_hash).not.toBe(created.invite.rawCode);
    await expect(validateInviteByCode(pool, created.invite.rawCode.toLowerCase(), INVITE_SECRET)).resolves.toEqual(
      expect.objectContaining({ id: created.invite.id, roomId: created.room.id })
    );
  });

  it('uses room timezone when creating today daily canvas', async () => {
    const created = await createRoomWithTodayCanvas(pool, {
      name: 'Room Repository Timezone Test',
      ownerActorKey: actorKey('timezone-owner'),
      publicIdPrefix: TEST_PREFIX,
      inviteSecret: INVITE_SECRET,
      timezone: 'Asia/Seoul',
      today: new Date('2026-05-16T15:30:00.000Z')
    });

    expect(created.dailyCanvas.canvasDate).toBe('2026-05-17');
    expect(created.canvas.id).toContain('20260517');
  });

  it('loads today daily canvas for the current room-local date', async () => {
    const created = await createRoomWithTodayCanvas(pool, {
      name: 'Room Repository Current Today Test',
      ownerActorKey: actorKey('current-today-owner'),
      publicIdPrefix: TEST_PREFIX,
      inviteSecret: INVITE_SECRET,
      timezone: 'Asia/Seoul'
    });

    const loaded = await getRoomToday(pool, created.room.publicId);

    expect(loaded?.dailyCanvas.canvasId).toBe(created.dailyCanvas.canvasId);
  });

  it('creates a new active daily canvas when an existing room is opened on a later local date', async () => {
    const created = await createRoomWithTodayCanvas(pool, {
      name: 'Room Repository Later Today Test',
      ownerActorKey: actorKey('later-today-owner'),
      publicIdPrefix: TEST_PREFIX,
      inviteSecret: INVITE_SECRET,
      timezone: 'Asia/Seoul',
      today: new Date('2026-05-17T03:30:00.000Z')
    });

    const ensured = await ensureRoomToday(pool, created.room.publicId, {
      today: new Date('2026-05-18T03:30:00.000Z')
    });

    expect(ensured?.room.id).toBe(created.room.id);
    expect(ensured?.dailyCanvas.canvasDate).toBe('2026-05-18');
    expect(ensured?.dailyCanvas.canvasId).not.toBe(created.dailyCanvas.canvasId);
    expect(ensured?.canvas.id).toContain('20260518');

    const rowCounts = await pool.query(
      `SELECT count(*)::int AS count
       FROM daily_canvases
       WHERE room_id = $1`,
      [created.room.id]
    );
    expect(rowCounts.rows[0]).toEqual({ count: 2 });
  });

  it('atomically consumes invite uses and records the invite room', async () => {
    const created = await createRoomWithTodayCanvas(pool, {
      name: 'Room Repository Consume Invite Test',
      ownerActorKey: actorKey('consume-owner'),
      publicIdPrefix: TEST_PREFIX,
      inviteSecret: INVITE_SECRET
    });
    const invite = await createInvite(pool, {
      roomId: created.room.id,
      createdByMemberId: created.ownerMember.id,
      inviteSecret: INVITE_SECRET,
      maxUses: 1
    });

    const results = await Promise.all([
      consumeInviteUse(pool, {
        rawToken: invite.rawToken,
        inviteSecret: INVITE_SECRET,
        actorKey: actorKey('consumer-a'),
        actorIpHash: 'a'.repeat(64)
      }),
      consumeInviteUse(pool, {
        rawToken: invite.rawToken,
        inviteSecret: INVITE_SECRET,
        actorKey: actorKey('consumer-b'),
        actorIpHash: 'b'.repeat(64)
      })
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.find(Boolean)).toEqual(expect.objectContaining({ id: invite.id, roomId: created.room.id, useCount: 1 }));

    const useRows = await pool.query(
      'SELECT invite_id, room_id, actor_key, actor_ip_hash FROM room_invite_uses WHERE invite_id = $1',
      [invite.id]
    );
    expect(useRows.rows).toHaveLength(1);
    expect(useRows.rows[0]).toEqual(
      expect.objectContaining({ invite_id: invite.id, room_id: created.room.id, actor_ip_hash: expect.stringMatching(/^[ab]{64}$/) })
    );

    const inviteRows = await pool.query('SELECT use_count FROM room_invites WHERE id = $1', [invite.id]);
    expect(inviteRows.rows[0].use_count).toBe(1);
  });

  it('does not delete or rewrite the legacy global canvas', async () => {
    const before = await pool.query('SELECT id, slug, width, height, created_at, updated_at FROM canvases WHERE id = $1', [
      DEFAULT_CANVAS_ID
    ]);
    expect(before.rowCount).toBe(1);

    await runFriendRoomMigration();

    const after = await pool.query('SELECT id, slug, width, height, created_at, updated_at FROM canvases WHERE id = $1', [
      DEFAULT_CANVAS_ID
    ]);

    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('does not rewrite the legacy global canvas when rerunning the migration runner', async () => {
    const before = await pool.query('SELECT id, slug, width, height, created_at, updated_at FROM canvases WHERE id = $1', [
      DEFAULT_CANVAS_ID
    ]);
    expect(before.rowCount).toBe(1);

    await runMigrations();

    const after = await pool.query('SELECT id, slug, width, height, created_at, updated_at FROM canvases WHERE id = $1', [
      DEFAULT_CANVAS_ID
    ]);

    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('rejects a revoked invite token', async () => {
    const created = await createRoomWithTodayCanvas(pool, {
      name: 'Room Repository Revoked Invite Test',
      ownerActorKey: actorKey('revoker'),
      publicIdPrefix: TEST_PREFIX,
      inviteSecret: INVITE_SECRET
    });
    const invite = await createInvite(pool, {
      roomId: created.room.id,
      createdByMemberId: created.ownerMember.id,
      inviteSecret: INVITE_SECRET
    });

    await revokeInvite(pool, invite.id, actorKey('revoker'));

    await expect(validateInvite(pool, invite.rawToken, INVITE_SECRET)).resolves.toBeNull();
  });

  it('upserts room membership by room and actor', async () => {
    const created = await createRoomWithTodayCanvas(pool, {
      name: 'Room Repository Member Upsert Test',
      ownerActorKey: actorKey('member-owner'),
      publicIdPrefix: TEST_PREFIX,
      inviteSecret: INVITE_SECRET
    });

    const first = await ensureRoomMember(pool, {
      roomId: created.room.id,
      actorKey: actorKey('guest'),
      role: 'guest',
      inviteId: created.invite.id
    });
    const second = await ensureRoomMember(pool, {
      roomId: created.room.id,
      actorKey: actorKey('guest'),
      role: 'member',
      inviteId: created.invite.id
    });

    expect(second.id).toBe(first.id);
    expect(second.role).toBe('member');

    const count = await pool.query('SELECT count(*)::int FROM room_members WHERE room_id = $1 AND actor_key = $2', [
      created.room.id,
      actorKey('guest')
    ]);
    expect(count.rows[0].count).toBe(1);
  });
});
