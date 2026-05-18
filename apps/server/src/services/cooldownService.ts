import Redis from 'ioredis';

export interface CooldownStore {
  consumeCooldown(actorKey: string, nowMs: number, cooldownMs: number): Promise<CooldownResult>;
  releaseCooldown(actorKey: string, expectedNextAvailableAtMs: number): Promise<void>;
}

export interface CooldownResult {
  allowed: boolean;
  nextAvailableAtMs: number;
  remainingMs: number;
}

const CONSUME_COOLDOWN_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
local nowMs = tonumber(ARGV[1])
local cooldownMs = tonumber(ARGV[2])
local ttlMs = tonumber(ARGV[3])

if existing then
  local existingNextAvailableAt = tonumber(existing)
  if existingNextAvailableAt and existingNextAvailableAt > nowMs then
    return {0, existingNextAvailableAt, existingNextAvailableAt - nowMs}
  end
end

local nextAvailableAtMs = nowMs + cooldownMs
redis.call('SET', KEYS[1], tostring(nextAvailableAtMs), 'PX', ttlMs)
return {1, nextAvailableAtMs, 0}
`;

const RELEASE_COOLDOWN_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if existing == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function cooldownKey(actorKey: string): string {
  return `cooldown:${actorKey}`;
}

function toCooldownResult(values: unknown): CooldownResult {
  if (!Array.isArray(values) || values.length !== 3) {
    throw new Error('Invalid cooldown store result');
  }

  const allowed = Number(values[0]);
  const nextAvailableAtMs = Number(values[1]);
  const remainingMs = Number(values[2]);
  return {
    allowed: allowed === 1,
    nextAvailableAtMs,
    remainingMs
  };
}

export class RedisCooldownStore implements CooldownStore {
  constructor(private readonly redis: Redis) {}

  async consumeCooldown(actorKey: string, nowMs: number, cooldownMs: number): Promise<CooldownResult> {
    const ttlMs = cooldownMs * 2;
    const result = await this.redis.eval(CONSUME_COOLDOWN_SCRIPT, 1, cooldownKey(actorKey), nowMs, cooldownMs, ttlMs);
    return toCooldownResult(result);
  }

  async releaseCooldown(actorKey: string, expectedNextAvailableAtMs: number): Promise<void> {
    await this.redis.eval(RELEASE_COOLDOWN_SCRIPT, 1, cooldownKey(actorKey), String(expectedNextAvailableAtMs));
  }
}

export class InMemoryCooldownStore implements CooldownStore {
  private readonly values = new Map<string, number>();
  private readonly locks = new Map<string, Promise<void>>();

  async releaseCooldown(actorKey: string, expectedNextAvailableAtMs: number): Promise<void> {
    await this.withActorLock(actorKey, async () => {
      if (this.values.get(actorKey) === expectedNextAvailableAtMs) {
        this.values.delete(actorKey);
      }
    });
  }

  async consumeCooldown(actorKey: string, nowMs: number, cooldownMs: number): Promise<CooldownResult> {
    return this.withActorLock(actorKey, async () => {
      const existingNextAvailableAt = this.values.get(actorKey) ?? null;
      if (existingNextAvailableAt && existingNextAvailableAt > nowMs) {
        return {
          allowed: false,
          nextAvailableAtMs: existingNextAvailableAt,
          remainingMs: existingNextAvailableAt - nowMs
        };
      }

      const nextAvailableAtMs = nowMs + cooldownMs;
      this.values.set(actorKey, nextAvailableAtMs);
      return { allowed: true, nextAvailableAtMs, remainingMs: 0 };
    });
  }

  private async withActorLock<T>(actorKey: string, callback: () => Promise<T> | T): Promise<T> {
    const previousLock = this.locks.get(actorKey) ?? Promise.resolve();
    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const queuedLock = previousLock.then(() => currentLock);
    this.locks.set(actorKey, queuedLock);

    await previousLock;
    try {
      return await callback();
    } finally {
      releaseLock();
      if (this.locks.get(actorKey) === queuedLock) {
        this.locks.delete(actorKey);
      }
    }
  }
}

export async function checkAndConsumeCooldown(
  store: CooldownStore,
  actorKey: string,
  nowMs: number,
  cooldownMs: number
): Promise<CooldownResult> {
  return store.consumeCooldown(actorKey, nowMs, cooldownMs);
}
