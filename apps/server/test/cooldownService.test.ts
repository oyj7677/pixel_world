import { describe, expect, it } from 'vitest';
import { InMemoryCooldownStore, checkAndConsumeCooldown } from '../src/services/cooldownService';

describe('checkAndConsumeCooldown', () => {
  it('allows first placement and blocks the next placement until cooldown expires', async () => {
    const store = new InMemoryCooldownStore();
    const first = await checkAndConsumeCooldown(store, 'actor-a', 1000, 10000);
    expect(first).toEqual({ allowed: true, nextAvailableAtMs: 11000, remainingMs: 0 });

    const second = await checkAndConsumeCooldown(store, 'actor-a', 5000, 10000);
    expect(second).toEqual({ allowed: false, nextAvailableAtMs: 11000, remainingMs: 6000 });

    const third = await checkAndConsumeCooldown(store, 'actor-a', 11000, 10000);
    expect(third).toEqual({ allowed: true, nextAvailableAtMs: 21000, remainingMs: 0 });
  });

  it('atomically allows only one concurrent consume for the same actor and timestamp', async () => {
    const store = new InMemoryCooldownStore();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => checkAndConsumeCooldown(store, 'actor-a', 1000, 10000))
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed)).toHaveLength(7);
    expect(results.every((result) => result.nextAvailableAtMs === 11000)).toBe(true);
  });

  it('releases a consumed cooldown so a failed placement can retry immediately', async () => {
    const store = new InMemoryCooldownStore();
    const first = await checkAndConsumeCooldown(store, 'actor-a', 1000, 10000);
    expect(first.allowed).toBe(true);

    await store.releaseCooldown('actor-a', first.nextAvailableAtMs);

    const retry = await checkAndConsumeCooldown(store, 'actor-a', 1001, 10000);
    expect(retry).toEqual({ allowed: true, nextAvailableAtMs: 11001, remainingMs: 0 });
  });

  it('does not let a stale release delete a newer cooldown for the same actor', async () => {
    const store = new InMemoryCooldownStore();
    const first = await checkAndConsumeCooldown(store, 'actor-a', 1000, 1000);
    expect(first).toEqual({ allowed: true, nextAvailableAtMs: 2000, remainingMs: 0 });

    const newer = await checkAndConsumeCooldown(store, 'actor-a', 2000, 1000);
    expect(newer).toEqual({ allowed: true, nextAvailableAtMs: 3000, remainingMs: 0 });

    await store.releaseCooldown('actor-a', first.nextAvailableAtMs);

    const blocked = await checkAndConsumeCooldown(store, 'actor-a', 2500, 1000);
    expect(blocked).toEqual({ allowed: false, nextAvailableAtMs: 3000, remainingMs: 500 });
  });
});
