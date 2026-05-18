import Redis from 'ioredis';
import { calculateMaxSavedPixelCount, calculateSavedPixelAllowance } from '@pixel-world/shared';

export interface PixelAllowancePolicySnapshot {
  dynamicAllowanceIntervalMs: number;
  pixelAllowanceMaxStorageMs: number;
  maxSavedPixelCount: number;
}

export interface PixelAllowanceResult {
  allowed: boolean;
  savedPixelCount: number;
  maxSavedPixelCount: number;
  nextPixelSavedAtMs: number;
  maxStorageEndsAtMs: number;
  remainingMs: number;
}

export interface PixelAllowanceStore {
  getPixelAllowanceState(
    scopeKey: string,
    actorKey: string,
    nowMs: number,
    policy: PixelAllowancePolicySnapshot
  ): Promise<PixelAllowanceResult>;
  consumePixelAllowance(
    scopeKey: string,
    actorKey: string,
    nowMs: number,
    policy: PixelAllowancePolicySnapshot
  ): Promise<PixelAllowanceResult>;
  refundPixelAllowance(
    scopeKey: string,
    actorKey: string,
    nowMs: number,
    policy: PixelAllowancePolicySnapshot
  ): Promise<PixelAllowanceResult>;
}

interface NormalizedPixelAllowancePolicy {
  dynamicAllowanceIntervalMs: number;
  pixelAllowanceMaxStorageMs: number;
  maxSavedPixelCount: number;
}

interface PixelAllowanceState {
  savedPixelCount: number;
  lastAccruedAtMs: number;
}

const PEEK_PIXEL_ALLOWANCE_SCRIPT = `
local savedPixelCount = tonumber(redis.call('HGET', KEYS[1], 'savedPixelCount'))
local lastAccruedAtMs = tonumber(redis.call('HGET', KEYS[1], 'lastAccruedAtMs'))
local nowMs = tonumber(ARGV[1])
local intervalMs = tonumber(ARGV[2])
local maxSavedPixelCount = tonumber(ARGV[3])

if not savedPixelCount or not lastAccruedAtMs then
  savedPixelCount = 1
  lastAccruedAtMs = nowMs
end

if savedPixelCount > maxSavedPixelCount then
  savedPixelCount = maxSavedPixelCount
end

local elapsedMs = nowMs - lastAccruedAtMs
if elapsedMs < 0 then
  elapsedMs = 0
end

local elapsedIntervals = math.floor(elapsedMs / intervalMs)
local accruedSavedPixelCount = savedPixelCount + elapsedIntervals
if accruedSavedPixelCount > maxSavedPixelCount then
  accruedSavedPixelCount = maxSavedPixelCount
end

local accruedAtMs = lastAccruedAtMs + elapsedIntervals * intervalMs
local nextPixelSavedAtMs
if nowMs < lastAccruedAtMs then
  nextPixelSavedAtMs = lastAccruedAtMs
else
  nextPixelSavedAtMs = accruedAtMs + intervalMs
end

local remainingMs = 0
if accruedSavedPixelCount <= 0 then
  remainingMs = nextPixelSavedAtMs - nowMs
  if remainingMs < 0 then
    remainingMs = 0
  end
end

local missingSavedPixelCount = maxSavedPixelCount - accruedSavedPixelCount
if missingSavedPixelCount < 0 then
  missingSavedPixelCount = 0
end
local maxStorageEndsAtMs = accruedAtMs + missingSavedPixelCount * intervalMs
local allowed = 0
if accruedSavedPixelCount > 0 then
  allowed = 1
end

return {allowed, accruedSavedPixelCount, maxSavedPixelCount, nextPixelSavedAtMs, maxStorageEndsAtMs, remainingMs}
`;

const CONSUME_PIXEL_ALLOWANCE_SCRIPT = `
local savedPixelCount = tonumber(redis.call('HGET', KEYS[1], 'savedPixelCount'))
local lastAccruedAtMs = tonumber(redis.call('HGET', KEYS[1], 'lastAccruedAtMs'))
local nowMs = tonumber(ARGV[1])
local intervalMs = tonumber(ARGV[2])
local maxSavedPixelCount = tonumber(ARGV[3])
local ttlMs = tonumber(ARGV[4])

if not savedPixelCount or not lastAccruedAtMs then
  savedPixelCount = 1
  lastAccruedAtMs = nowMs
end

if savedPixelCount > maxSavedPixelCount then
  savedPixelCount = maxSavedPixelCount
end

local elapsedMs = nowMs - lastAccruedAtMs
if elapsedMs < 0 then
  elapsedMs = 0
end

local elapsedIntervals = math.floor(elapsedMs / intervalMs)
local accruedSavedPixelCount = savedPixelCount + elapsedIntervals
if accruedSavedPixelCount > maxSavedPixelCount then
  accruedSavedPixelCount = maxSavedPixelCount
end

local accruedAtMs = lastAccruedAtMs + elapsedIntervals * intervalMs
local nextPixelSavedAtMs
if nowMs < lastAccruedAtMs then
  nextPixelSavedAtMs = lastAccruedAtMs
else
  nextPixelSavedAtMs = accruedAtMs + intervalMs
end

if accruedSavedPixelCount <= 0 then
  redis.call('HSET', KEYS[1], 'savedPixelCount', tostring(accruedSavedPixelCount), 'lastAccruedAtMs', tostring(accruedAtMs))
  redis.call('PEXPIRE', KEYS[1], ttlMs)
  local remainingMs = nextPixelSavedAtMs - nowMs
  if remainingMs < 0 then
    remainingMs = 0
  end
  local missingSavedPixelCount = maxSavedPixelCount - accruedSavedPixelCount
  if missingSavedPixelCount < 0 then
    missingSavedPixelCount = 0
  end
  local maxStorageEndsAtMs = accruedAtMs + missingSavedPixelCount * intervalMs
  return {0, accruedSavedPixelCount, maxSavedPixelCount, nextPixelSavedAtMs, maxStorageEndsAtMs, remainingMs}
end

local remainingSavedPixelCount = accruedSavedPixelCount - 1
redis.call('HSET', KEYS[1], 'savedPixelCount', tostring(remainingSavedPixelCount), 'lastAccruedAtMs', tostring(accruedAtMs))
redis.call('PEXPIRE', KEYS[1], ttlMs)
local missingSavedPixelCount = maxSavedPixelCount - remainingSavedPixelCount
if missingSavedPixelCount < 0 then
  missingSavedPixelCount = 0
end
local maxStorageEndsAtMs = accruedAtMs + missingSavedPixelCount * intervalMs
return {1, remainingSavedPixelCount, maxSavedPixelCount, nextPixelSavedAtMs, maxStorageEndsAtMs, 0}
`;

const REFUND_PIXEL_ALLOWANCE_SCRIPT = `
local savedPixelCount = tonumber(redis.call('HGET', KEYS[1], 'savedPixelCount'))
local lastAccruedAtMs = tonumber(redis.call('HGET', KEYS[1], 'lastAccruedAtMs'))
local nowMs = tonumber(ARGV[1])
local intervalMs = tonumber(ARGV[2])
local maxSavedPixelCount = tonumber(ARGV[3])
local ttlMs = tonumber(ARGV[4])

if not savedPixelCount or not lastAccruedAtMs then
  savedPixelCount = 0
  lastAccruedAtMs = nowMs
end

if savedPixelCount > maxSavedPixelCount then
  savedPixelCount = maxSavedPixelCount
end

local elapsedMs = nowMs - lastAccruedAtMs
if elapsedMs < 0 then
  elapsedMs = 0
end

local elapsedIntervals = math.floor(elapsedMs / intervalMs)
local accruedSavedPixelCount = savedPixelCount + elapsedIntervals
if accruedSavedPixelCount > maxSavedPixelCount then
  accruedSavedPixelCount = maxSavedPixelCount
end

local refundedSavedPixelCount = accruedSavedPixelCount + 1
if refundedSavedPixelCount > maxSavedPixelCount then
  refundedSavedPixelCount = maxSavedPixelCount
end

local accruedAtMs = lastAccruedAtMs + elapsedIntervals * intervalMs
local nextPixelSavedAtMs
if nowMs < lastAccruedAtMs then
  nextPixelSavedAtMs = lastAccruedAtMs
else
  nextPixelSavedAtMs = accruedAtMs + intervalMs
end

redis.call('HSET', KEYS[1], 'savedPixelCount', tostring(refundedSavedPixelCount), 'lastAccruedAtMs', tostring(accruedAtMs))
redis.call('PEXPIRE', KEYS[1], ttlMs)

local missingSavedPixelCount = maxSavedPixelCount - refundedSavedPixelCount
if missingSavedPixelCount < 0 then
  missingSavedPixelCount = 0
end
local maxStorageEndsAtMs = accruedAtMs + missingSavedPixelCount * intervalMs
local allowed = 0
if refundedSavedPixelCount > 0 then
  allowed = 1
end

return {allowed, refundedSavedPixelCount, maxSavedPixelCount, nextPixelSavedAtMs, maxStorageEndsAtMs, 0}
`;

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function normalizePolicy(policy: PixelAllowancePolicySnapshot): NormalizedPixelAllowancePolicy {
  const dynamicAllowanceIntervalMs = normalizePositiveInteger(policy.dynamicAllowanceIntervalMs, 1);
  const pixelAllowanceMaxStorageMs = normalizePositiveInteger(
    policy.pixelAllowanceMaxStorageMs,
    dynamicAllowanceIntervalMs
  );
  const requestedMaxSavedPixelCount = normalizePositiveInteger(policy.maxSavedPixelCount, 1);
  const storageMaxSavedPixelCount = calculateMaxSavedPixelCount({
    maxStorageMs: pixelAllowanceMaxStorageMs,
    allowanceIntervalMs: dynamicAllowanceIntervalMs
  });

  return {
    dynamicAllowanceIntervalMs,
    pixelAllowanceMaxStorageMs,
    maxSavedPixelCount: Math.min(requestedMaxSavedPixelCount, storageMaxSavedPixelCount)
  };
}

function pixelAllowanceKey(scopeKey: string, actorKey: string): string {
  return `pixelAllowance:${JSON.stringify([scopeKey, actorKey])}`;
}

function ttlMsForPolicy(policy: NormalizedPixelAllowancePolicy): number {
  return Math.max(policy.pixelAllowanceMaxStorageMs * 2, policy.dynamicAllowanceIntervalMs * 2);
}

function toPixelAllowanceResult(values: unknown): PixelAllowanceResult {
  if (!Array.isArray(values) || values.length !== 6) {
    throw new Error('Invalid pixel allowance store result');
  }

  return {
    allowed: Number(values[0]) === 1,
    savedPixelCount: Number(values[1]),
    maxSavedPixelCount: Number(values[2]),
    nextPixelSavedAtMs: Number(values[3]),
    maxStorageEndsAtMs: Number(values[4]),
    remainingMs: Number(values[5])
  };
}

function calculateMaxStorageEndsAtMs(
  savedPixelCount: number,
  lastAccruedAtMs: number,
  policy: NormalizedPixelAllowancePolicy
): number {
  return (
    lastAccruedAtMs +
    Math.max(0, policy.maxSavedPixelCount - savedPixelCount) * policy.dynamicAllowanceIntervalMs
  );
}

function toResult(
  savedPixelCount: number,
  lastAccruedAtMs: number,
  nextPixelSavedAtMs: number,
  nowMs: number,
  policy: NormalizedPixelAllowancePolicy
): PixelAllowanceResult {
  return {
    allowed: savedPixelCount > 0,
    savedPixelCount,
    maxSavedPixelCount: policy.maxSavedPixelCount,
    nextPixelSavedAtMs,
    maxStorageEndsAtMs: calculateMaxStorageEndsAtMs(savedPixelCount, lastAccruedAtMs, policy),
    remainingMs: savedPixelCount > 0 ? 0 : Math.max(0, nextPixelSavedAtMs - nowMs)
  };
}

export function getUnlimitedPixelAllowanceState(
  nowMs: number,
  policy: PixelAllowancePolicySnapshot
): PixelAllowanceResult {
  const normalizedPolicy = normalizePolicy(policy);
  const now = Math.floor(nowMs);

  return {
    allowed: true,
    savedPixelCount: normalizedPolicy.maxSavedPixelCount,
    maxSavedPixelCount: normalizedPolicy.maxSavedPixelCount,
    nextPixelSavedAtMs: now,
    maxStorageEndsAtMs: now,
    remainingMs: 0
  };
}

function accrueState(
  state: PixelAllowanceState,
  nowMs: number,
  policy: NormalizedPixelAllowancePolicy
): PixelAllowanceResult & { lastAccruedAtMs: number } {
  const accrued = calculateSavedPixelAllowance({
    savedCount: state.savedPixelCount,
    lastAccruedAtMs: state.lastAccruedAtMs,
    nowMs,
    allowanceIntervalMs: policy.dynamicAllowanceIntervalMs,
    maxSavedCount: policy.maxSavedPixelCount
  });

  return {
    ...toResult(accrued.savedCount, accrued.lastAccruedAtMs, accrued.nextPixelSavedAtMs, nowMs, policy),
    lastAccruedAtMs: accrued.lastAccruedAtMs
  };
}

function peekState(
  state: PixelAllowanceState | null,
  nowMs: number,
  policy: NormalizedPixelAllowancePolicy
): PixelAllowanceResult {
  const currentState = state ?? { savedPixelCount: 1, lastAccruedAtMs: nowMs };
  const { lastAccruedAtMs: _lastAccruedAtMs, ...result } = accrueState(currentState, nowMs, policy);
  return result;
}

function consumeState(
  state: PixelAllowanceState | null,
  nowMs: number,
  policy: NormalizedPixelAllowancePolicy
): { result: PixelAllowanceResult; nextState: PixelAllowanceState } {
  const currentState = state ?? { savedPixelCount: 1, lastAccruedAtMs: nowMs };
  const accrued = accrueState(currentState, nowMs, policy);

  if (!accrued.allowed) {
    const { lastAccruedAtMs: _lastAccruedAtMs, ...result } = accrued;
    return {
      result,
      nextState: {
        savedPixelCount: accrued.savedPixelCount,
        lastAccruedAtMs: accrued.lastAccruedAtMs
      }
    };
  }

  const savedPixelCount = accrued.savedPixelCount - 1;
  const result = toResult(savedPixelCount, accrued.lastAccruedAtMs, accrued.nextPixelSavedAtMs, nowMs, policy);

  return {
    result: {
      ...result,
      allowed: true,
      remainingMs: 0
    },
    nextState: {
      savedPixelCount,
      lastAccruedAtMs: accrued.lastAccruedAtMs
    }
  };
}

function refundState(
  state: PixelAllowanceState | null,
  nowMs: number,
  policy: NormalizedPixelAllowancePolicy
): { result: PixelAllowanceResult; nextState: PixelAllowanceState } {
  const currentState = state ?? { savedPixelCount: 0, lastAccruedAtMs: nowMs };
  const accrued = accrueState(currentState, nowMs, policy);
  const savedPixelCount = Math.min(policy.maxSavedPixelCount, accrued.savedPixelCount + 1);

  return {
    result: toResult(savedPixelCount, accrued.lastAccruedAtMs, accrued.nextPixelSavedAtMs, nowMs, policy),
    nextState: {
      savedPixelCount,
      lastAccruedAtMs: accrued.lastAccruedAtMs
    }
  };
}

export class RedisPixelAllowanceStore implements PixelAllowanceStore {
  constructor(private readonly redis: Redis) {}

  async getPixelAllowanceState(
    scopeKey: string,
    actorKey: string,
    nowMs: number,
    policy: PixelAllowancePolicySnapshot
  ): Promise<PixelAllowanceResult> {
    const normalizedPolicy = normalizePolicy(policy);
    const result = await this.redis.eval(
      PEEK_PIXEL_ALLOWANCE_SCRIPT,
      1,
      pixelAllowanceKey(scopeKey, actorKey),
      Math.floor(nowMs),
      normalizedPolicy.dynamicAllowanceIntervalMs,
      normalizedPolicy.maxSavedPixelCount
    );

    return toPixelAllowanceResult(result);
  }

  async consumePixelAllowance(
    scopeKey: string,
    actorKey: string,
    nowMs: number,
    policy: PixelAllowancePolicySnapshot
  ): Promise<PixelAllowanceResult> {
    const normalizedPolicy = normalizePolicy(policy);
    const result = await this.redis.eval(
      CONSUME_PIXEL_ALLOWANCE_SCRIPT,
      1,
      pixelAllowanceKey(scopeKey, actorKey),
      Math.floor(nowMs),
      normalizedPolicy.dynamicAllowanceIntervalMs,
      normalizedPolicy.maxSavedPixelCount,
      ttlMsForPolicy(normalizedPolicy)
    );

    return toPixelAllowanceResult(result);
  }

  async refundPixelAllowance(
    scopeKey: string,
    actorKey: string,
    nowMs: number,
    policy: PixelAllowancePolicySnapshot
  ): Promise<PixelAllowanceResult> {
    const normalizedPolicy = normalizePolicy(policy);
    const result = await this.redis.eval(
      REFUND_PIXEL_ALLOWANCE_SCRIPT,
      1,
      pixelAllowanceKey(scopeKey, actorKey),
      Math.floor(nowMs),
      normalizedPolicy.dynamicAllowanceIntervalMs,
      normalizedPolicy.maxSavedPixelCount,
      ttlMsForPolicy(normalizedPolicy)
    );

    return toPixelAllowanceResult(result);
  }
}

export class InMemoryPixelAllowanceStore implements PixelAllowanceStore {
  private readonly values = new Map<string, PixelAllowanceState>();
  private readonly locks = new Map<string, Promise<void>>();

  async getPixelAllowanceState(
    scopeKey: string,
    actorKey: string,
    nowMs: number,
    policy: PixelAllowancePolicySnapshot
  ): Promise<PixelAllowanceResult> {
    const key = pixelAllowanceKey(scopeKey, actorKey);
    const normalizedPolicy = normalizePolicy(policy);

    return this.withKeyLock(key, () => peekState(this.values.get(key) ?? null, Math.floor(nowMs), normalizedPolicy));
  }

  async consumePixelAllowance(
    scopeKey: string,
    actorKey: string,
    nowMs: number,
    policy: PixelAllowancePolicySnapshot
  ): Promise<PixelAllowanceResult> {
    const key = pixelAllowanceKey(scopeKey, actorKey);
    const normalizedPolicy = normalizePolicy(policy);

    return this.withKeyLock(key, () => {
      const { result, nextState } = consumeState(this.values.get(key) ?? null, Math.floor(nowMs), normalizedPolicy);
      this.values.set(key, nextState);
      return result;
    });
  }

  async refundPixelAllowance(
    scopeKey: string,
    actorKey: string,
    nowMs: number,
    policy: PixelAllowancePolicySnapshot
  ): Promise<PixelAllowanceResult> {
    const key = pixelAllowanceKey(scopeKey, actorKey);
    const normalizedPolicy = normalizePolicy(policy);

    return this.withKeyLock(key, () => {
      const { result, nextState } = refundState(this.values.get(key) ?? null, Math.floor(nowMs), normalizedPolicy);
      this.values.set(key, nextState);
      return result;
    });
  }

  private async withKeyLock<T>(key: string, callback: () => Promise<T> | T): Promise<T> {
    const previousLock = this.locks.get(key) ?? Promise.resolve();
    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const queuedLock = previousLock.then(() => currentLock);
    this.locks.set(key, queuedLock);

    await previousLock;
    try {
      return await callback();
    } finally {
      releaseLock();
      if (this.locks.get(key) === queuedLock) {
        this.locks.delete(key);
      }
    }
  }
}

export async function getPixelAllowanceState(
  store: PixelAllowanceStore,
  scopeKey: string,
  actorKey: string,
  nowMs: number,
  policy: PixelAllowancePolicySnapshot
): Promise<PixelAllowanceResult> {
  return store.getPixelAllowanceState(scopeKey, actorKey, nowMs, policy);
}

export async function checkAndConsumePixelAllowance(
  store: PixelAllowanceStore,
  scopeKey: string,
  actorKey: string,
  nowMs: number,
  policy: PixelAllowancePolicySnapshot
): Promise<PixelAllowanceResult> {
  return store.consumePixelAllowance(scopeKey, actorKey, nowMs, policy);
}

export async function refundPixelAllowance(
  store: PixelAllowanceStore,
  scopeKey: string,
  actorKey: string,
  nowMs: number,
  policy: PixelAllowancePolicySnapshot
): Promise<PixelAllowanceResult> {
  return store.refundPixelAllowance(scopeKey, actorKey, nowMs, policy);
}
