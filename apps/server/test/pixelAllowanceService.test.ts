import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemoryPixelAllowanceStore,
  RedisPixelAllowanceStore,
  checkAndConsumePixelAllowance,
  getPixelAllowanceState,
  refundPixelAllowance
} from '../src/services/pixelAllowanceService';

const allowancePolicy = {
  dynamicAllowanceIntervalMs: 1000,
  pixelAllowanceMaxStorageMs: 3000,
  maxSavedPixelCount: 3
};

const clampedAllowancePolicy = {
  dynamicAllowanceIntervalMs: 1000,
  pixelAllowanceMaxStorageMs: 1500,
  maxSavedPixelCount: 3
};

const highCapAllowancePolicy = {
  dynamicAllowanceIntervalMs: 1000,
  pixelAllowanceMaxStorageMs: 10000,
  maxSavedPixelCount: 10
};

describe('checkAndConsumePixelAllowance', () => {
  it('allows the first placement and reports the remaining saved count', async () => {
    const store = new InMemoryPixelAllowanceStore();

    const result = await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 1000, allowancePolicy);

    expect(result).toEqual({
      allowed: true,
      savedPixelCount: 0,
      maxSavedPixelCount: 3,
      nextPixelSavedAtMs: 2000,
      maxStorageEndsAtMs: 4000,
      remainingMs: 0
    });
  });

  it('blocks when no saved actions are available and then allows after accrual', async () => {
    const store = new InMemoryPixelAllowanceStore();
    await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 1000, allowancePolicy);

    const blocked = await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 1500, allowancePolicy);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remainingMs).toBe(500);

    const allowed = await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 2000, allowancePolicy);
    expect(allowed.allowed).toBe(true);
    expect(allowed.savedPixelCount).toBe(0);
  });

  it('stores multiple saved actions up to the max storage cap', async () => {
    const store = new InMemoryPixelAllowanceStore();
    await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 0, allowancePolicy);

    const afterBreak = await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 5000, allowancePolicy);

    expect(afterBreak.allowed).toBe(true);
    expect(afterBreak.savedPixelCount).toBe(2);
    expect(afterBreak.maxSavedPixelCount).toBe(3);
    expect(afterBreak.maxStorageEndsAtMs).toBe(6000);
  });

  it('clamps saved actions to the whole-action cap derived from max storage', async () => {
    const store = new InMemoryPixelAllowanceStore();
    await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 0, clampedAllowancePolicy);

    const afterBreak = await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 5000, clampedAllowancePolicy);

    expect(afterBreak.allowed).toBe(true);
    expect(afterBreak.maxSavedPixelCount).toBe(1);
    expect(afterBreak.savedPixelCount).toBe(0);
    expect(afterBreak.maxStorageEndsAtMs).toBe(6000);
  });


  it('peeks accrued allowance without consuming it', async () => {
    const store = new InMemoryPixelAllowanceStore();
    await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 1000, allowancePolicy);

    const blockedPeek = await getPixelAllowanceState(store, 'global', 'actor-a', 1500, allowancePolicy);
    expect(blockedPeek).toEqual({
      allowed: false,
      savedPixelCount: 0,
      maxSavedPixelCount: 3,
      nextPixelSavedAtMs: 2000,
      maxStorageEndsAtMs: 4000,
      remainingMs: 500
    });

    const readyPeek = await getPixelAllowanceState(store, 'global', 'actor-a', 2000, allowancePolicy);
    expect(readyPeek).toEqual({
      allowed: true,
      savedPixelCount: 1,
      maxSavedPixelCount: 3,
      nextPixelSavedAtMs: 3000,
      maxStorageEndsAtMs: 4000,
      remainingMs: 0
    });

    const consumeAfterPeek = await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 2000, allowancePolicy);
    expect(consumeAfterPeek.allowed).toBe(true);
    expect(consumeAfterPeek.savedPixelCount).toBe(0);
  });

  it('refunds a consumed allowance action after placement failure', async () => {
    const store = new InMemoryPixelAllowanceStore();
    await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 1000, allowancePolicy);

    const refunded = await refundPixelAllowance(store, 'global', 'actor-a', 1001, allowancePolicy);
    expect(refunded).toEqual({
      allowed: true,
      savedPixelCount: 1,
      maxSavedPixelCount: 3,
      nextPixelSavedAtMs: 2000,
      maxStorageEndsAtMs: 3000,
      remainingMs: 0
    });

    const consumeAfterRefund = await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 1002, allowancePolicy);
    expect(consumeAfterRefund.allowed).toBe(true);
    expect(consumeAfterRefund.savedPixelCount).toBe(0);
  });

  it('clamps already saved actions when the policy cap decreases', async () => {
    const store = new InMemoryPixelAllowanceStore();
    await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 0, highCapAllowancePolicy);
    const highCapAccrual = await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 5000, highCapAllowancePolicy);
    expect(highCapAccrual.savedPixelCount).toBe(4);

    const afterCapDecrease = await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 6000, allowancePolicy);

    expect(afterCapDecrease.allowed).toBe(true);
    expect(afterCapDecrease.maxSavedPixelCount).toBe(3);
    expect(afterCapDecrease.savedPixelCount).toBe(2);
    expect(afterCapDecrease.maxStorageEndsAtMs).toBe(7000);
  });


  it('clamps several over-cap saved actions when the policy cap decreases', async () => {
    const store = new InMemoryPixelAllowanceStore();
    await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 0, highCapAllowancePolicy);
    const highCapAccrual = await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 10000, highCapAllowancePolicy);
    expect(highCapAccrual.savedPixelCount).toBe(9);

    const afterCapDecrease = await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 11000, allowancePolicy);

    expect(afterCapDecrease.allowed).toBe(true);
    expect(afterCapDecrease.maxSavedPixelCount).toBe(3);
    expect(afterCapDecrease.savedPixelCount).toBe(2);
    expect(afterCapDecrease.maxStorageEndsAtMs).toBe(12000);
  });

  it('scopes saved allowance by project scope and actor', async () => {
    const store = new InMemoryPixelAllowanceStore();
    await checkAndConsumePixelAllowance(store, 'global', 'actor-a', 1000, allowancePolicy);

    const otherActor = await checkAndConsumePixelAllowance(store, 'global', 'actor-b', 1001, allowancePolicy);
    const otherScope = await checkAndConsumePixelAllowance(store, 'room-2', 'actor-a', 1001, allowancePolicy);

    expect(otherActor.allowed).toBe(true);
    expect(otherScope.allowed).toBe(true);
  });

  it('atomically allows only one concurrent consume when one saved action exists', async () => {
    const store = new InMemoryPixelAllowanceStore();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => checkAndConsumePixelAllowance(store, 'global', 'actor-a', 1000, allowancePolicy))
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed)).toHaveLength(7);
  });
});

describe('RedisPixelAllowanceStore', () => {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const runId = `pixel-allowance-service-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1000
  });
  const store = new RedisPixelAllowanceStore(redis);
  const redisKeys = new Set<string>();

  function scopeKey(name: string): string {
    return `${runId}:${name}`;
  }

  function actorKey(name: string): string {
    return `${runId}:${name}`;
  }

  function allowanceRedisKey(scope: string, actor: string): string {
    const key = `pixelAllowance:${JSON.stringify([scope, actor])}`;
    redisKeys.add(key);
    return key;
  }

  beforeAll(async () => {
    await redis.connect();
  });

  afterAll(async () => {
    if (redis.status !== 'end') {
      if (redisKeys.size > 0) {
        await redis.del(...redisKeys);
      }
      redis.disconnect();
    }
  });

  it('allows the first consume and stores a bounded TTL', async () => {
    const scope = scopeKey('first-consume');
    const actor = actorKey('actor-a');
    const key = allowanceRedisKey(scope, actor);

    const result = await checkAndConsumePixelAllowance(store, scope, actor, 1000, allowancePolicy);
    const ttlMs = await redis.pttl(key);

    expect(result).toEqual({
      allowed: true,
      savedPixelCount: 0,
      maxSavedPixelCount: 3,
      nextPixelSavedAtMs: 2000,
      maxStorageEndsAtMs: 4000,
      remainingMs: 0
    });
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(6000);
  });

  it('matches in-memory blocking and accrual behavior', async () => {
    const memoryStore = new InMemoryPixelAllowanceStore();
    const scope = scopeKey('parity');
    const actor = actorKey('actor-a');
    allowanceRedisKey(scope, actor);

    const redisFirst = await checkAndConsumePixelAllowance(store, scope, actor, 1000, allowancePolicy);
    const memoryFirst = await checkAndConsumePixelAllowance(memoryStore, scope, actor, 1000, allowancePolicy);
    expect(redisFirst).toEqual(memoryFirst);

    const redisBlocked = await checkAndConsumePixelAllowance(store, scope, actor, 1500, allowancePolicy);
    const memoryBlocked = await checkAndConsumePixelAllowance(memoryStore, scope, actor, 1500, allowancePolicy);
    expect(redisBlocked).toEqual(memoryBlocked);

    const redisAllowed = await checkAndConsumePixelAllowance(store, scope, actor, 2000, allowancePolicy);
    const memoryAllowed = await checkAndConsumePixelAllowance(memoryStore, scope, actor, 2000, allowancePolicy);
    expect(redisAllowed).toEqual(memoryAllowed);
  });

  it('matches in-memory peek and refund behavior', async () => {
    const memoryStore = new InMemoryPixelAllowanceStore();
    const scope = scopeKey('peek-refund-parity');
    const actor = actorKey('actor-a');
    allowanceRedisKey(scope, actor);

    await checkAndConsumePixelAllowance(store, scope, actor, 1000, allowancePolicy);
    await checkAndConsumePixelAllowance(memoryStore, scope, actor, 1000, allowancePolicy);

    const redisPeek = await getPixelAllowanceState(store, scope, actor, 1500, allowancePolicy);
    const memoryPeek = await getPixelAllowanceState(memoryStore, scope, actor, 1500, allowancePolicy);
    expect(redisPeek).toEqual(memoryPeek);

    const redisRefund = await refundPixelAllowance(store, scope, actor, 1501, allowancePolicy);
    const memoryRefund = await refundPixelAllowance(memoryStore, scope, actor, 1501, allowancePolicy);
    expect(redisRefund).toEqual(memoryRefund);

    const redisConsumeAfterRefund = await checkAndConsumePixelAllowance(store, scope, actor, 1502, allowancePolicy);
    const memoryConsumeAfterRefund = await checkAndConsumePixelAllowance(memoryStore, scope, actor, 1502, allowancePolicy);
    expect(redisConsumeAfterRefund).toEqual(memoryConsumeAfterRefund);
    expect(redisConsumeAfterRefund.allowed).toBe(true);
  });


  it('clamps already saved actions in Redis when the policy cap decreases', async () => {
    const scope = scopeKey('cap-decrease');
    const actor = actorKey('actor-a');
    allowanceRedisKey(scope, actor);

    await checkAndConsumePixelAllowance(store, scope, actor, 0, highCapAllowancePolicy);
    const highCapAccrual = await checkAndConsumePixelAllowance(store, scope, actor, 5000, highCapAllowancePolicy);
    expect(highCapAccrual.savedPixelCount).toBe(4);

    const afterCapDecrease = await checkAndConsumePixelAllowance(store, scope, actor, 6000, allowancePolicy);

    expect(afterCapDecrease.allowed).toBe(true);
    expect(afterCapDecrease.maxSavedPixelCount).toBe(3);
    expect(afterCapDecrease.savedPixelCount).toBe(2);
    expect(afterCapDecrease.maxStorageEndsAtMs).toBe(7000);
  });


  it('clamps several over-cap saved actions in Redis and keeps a bounded TTL after a cap decrease', async () => {
    const memoryStore = new InMemoryPixelAllowanceStore();
    const scope = scopeKey('cap-decrease-over-cap');
    const actor = actorKey('actor-a');
    const key = allowanceRedisKey(scope, actor);

    await checkAndConsumePixelAllowance(store, scope, actor, 0, highCapAllowancePolicy);
    await checkAndConsumePixelAllowance(memoryStore, scope, actor, 0, highCapAllowancePolicy);

    const redisHighCapAccrual = await checkAndConsumePixelAllowance(store, scope, actor, 10000, highCapAllowancePolicy);
    const memoryHighCapAccrual = await checkAndConsumePixelAllowance(memoryStore, scope, actor, 10000, highCapAllowancePolicy);
    expect(redisHighCapAccrual).toEqual(memoryHighCapAccrual);
    expect(redisHighCapAccrual.savedPixelCount).toBe(9);

    const redisAfterCapDecrease = await checkAndConsumePixelAllowance(store, scope, actor, 11000, allowancePolicy);
    const memoryAfterCapDecrease = await checkAndConsumePixelAllowance(memoryStore, scope, actor, 11000, allowancePolicy);
    const ttlMs = await redis.pttl(key);

    expect(redisAfterCapDecrease).toEqual(memoryAfterCapDecrease);
    expect(redisAfterCapDecrease.allowed).toBe(true);
    expect(redisAfterCapDecrease.maxSavedPixelCount).toBe(3);
    expect(redisAfterCapDecrease.savedPixelCount).toBe(2);
    expect(redisAfterCapDecrease.maxStorageEndsAtMs).toBe(12000);
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(6000);
  });

  it('atomically allows only one concurrent Redis consume when one saved action exists', async () => {
    const scope = scopeKey('concurrent-consume');
    const actor = actorKey('actor-a');
    allowanceRedisKey(scope, actor);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => checkAndConsumePixelAllowance(store, scope, actor, 1000, allowancePolicy))
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed)).toHaveLength(7);
    expect(results.every((result) => result.maxStorageEndsAtMs === 4000)).toBe(true);
  });

  it('uses the derived whole-action storage cap in Redis', async () => {
    const scope = scopeKey('clamped-storage');
    const actor = actorKey('actor-a');
    allowanceRedisKey(scope, actor);

    await checkAndConsumePixelAllowance(store, scope, actor, 0, clampedAllowancePolicy);
    const afterBreak = await checkAndConsumePixelAllowance(store, scope, actor, 5000, clampedAllowancePolicy);

    expect(afterBreak.allowed).toBe(true);
    expect(afterBreak.maxSavedPixelCount).toBe(1);
    expect(afterBreak.savedPixelCount).toBe(0);
    expect(afterBreak.maxStorageEndsAtMs).toBe(6000);
  });
});
