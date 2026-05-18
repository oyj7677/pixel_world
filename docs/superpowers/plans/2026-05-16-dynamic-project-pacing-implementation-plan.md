# Dynamic Project Pacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pressure-heavy fixed cooldown behavior with dynamic project-paced saved pixel allowance so map size, target completion time, and participant count determine how many pixels each participant can place.

**Architecture:** Add pure pacing math in `@pixel-world/shared`, add an atomic Redis/in-memory allowance store on the server, then wire Socket.IO placement to consume saved allowance instead of the current cooldown gate. Keep the first implementation compatible with the current global canvas by scoping allowance to `canvasId + actorKey`; later room work can swap the scope key to `roomId + actorKey` without changing the math.

**Tech Stack:** TypeScript, Vitest, Fastify, Socket.IO, Redis Lua via `ioredis`, Next.js/React Testing Library.

---

## Implementation scope

This plan implements only dynamic saved pixel allowance on the current canvas flow. It does not create friend rooms, replay, notifications, accounts, teams, streaks, or monetized refills.

Canonical formula:

```ts
dynamicAllowanceIntervalMs = targetCompletionMs * effectiveParticipantCount / requiredPixelCount;
```

Required example:

```text
100 × 100 = 10,000 required pixels
4 participants
6 hours = 21,600 seconds
21,600 * 4 / 10,000 = 8.64 seconds per saved pixel action
30-minute max storage => floor(1,800 / 8.64) = 208 saved actions
```

## Files and responsibilities

- Create `packages/shared/src/pixelAllowance.ts` — pure project pacing and saved allowance math.
- Modify `packages/shared/src/index.ts` — export the new allowance module.
- Create `packages/shared/test/pixelAllowance.test.ts` — formula, cap, validation, and accrual tests.
- Create `apps/server/src/services/pixelAllowanceService.ts` — Redis and in-memory atomic allowance consumption.
- Create `apps/server/test/pixelAllowanceService.test.ts` — store behavior and concurrency tests.
- Modify `apps/server/src/config.ts` — load pacing defaults from environment with safe same-day defaults.
- Modify `packages/shared/src/socketEvents.ts` — replace cooldown payloads with allowance payloads while keeping event name compatibility where useful.
- Modify `apps/server/src/realtime/socketServer.ts` — consume allowance in `placePixel`, emit allowance state in snapshot/update/rejection.
- Modify `apps/server/test/socketServer.test.ts` — prove multiple saved placements, cap behavior, and no urgency rejection copy.
- Modify `apps/web/src/app/page.tsx` — track allowance state from Socket.IO.
- Modify `apps/web/src/components/StatusBar.tsx` — display saved pixel count and next saved time without a progress bar.
- Modify `apps/web/test/statusBar.test.tsx` and `apps/web/test/homePageSocket.test.tsx` — UI wiring tests.
- Modify `README.md` — document pacing environment values and the 100×100 example.

---

### Task 1: Add shared dynamic pacing math

**Files:**
- Create: `packages/shared/src/pixelAllowance.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/pixelAllowance.test.ts`

- [ ] **Step 1: Write failing tests for formula, cap, and saved accrual**

Create `packages/shared/test/pixelAllowance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIXEL_ALLOWANCE_MAX_STORAGE_MS,
  DEFAULT_PROJECT_TARGET_COMPLETION_MS,
  calculateDynamicAllowanceIntervalMs,
  calculateMaxSavedPixelCount,
  calculateRequiredPixelCount,
  calculateSavedPixelAllowance,
  validateProjectPacingInput
} from '../src/pixelAllowance';

describe('dynamic project pacing', () => {
  it('calculates the required 100x100, 4 people, 6 hour pacing example', () => {
    const requiredPixelCount = calculateRequiredPixelCount({ width: 100, height: 100 });
    const intervalMs = calculateDynamicAllowanceIntervalMs({
      targetCompletionMs: DEFAULT_PROJECT_TARGET_COMPLETION_MS,
      effectiveParticipantCount: 4,
      requiredPixelCount
    });
    const maxSavedCount = calculateMaxSavedPixelCount({
      maxStorageMs: DEFAULT_PIXEL_ALLOWANCE_MAX_STORAGE_MS,
      allowanceIntervalMs: intervalMs
    });

    expect(requiredPixelCount).toBe(10000);
    expect(intervalMs).toBe(8640);
    expect(maxSavedCount).toBe(208);
  });

  it('subtracts fixed or pre-filled pixels from required count', () => {
    expect(calculateRequiredPixelCount({ width: 10, height: 10, fixedOrPreFilledPixels: 12 })).toBe(88);
  });

  it('rejects impossible pacing values before implementation uses them', () => {
    expect(validateProjectPacingInput({ requiredPixelCount: 0, targetCompletionMs: 1000, effectiveParticipantCount: 1 })).toEqual({
      ok: false,
      reason: 'required_pixel_count_invalid'
    });
    expect(validateProjectPacingInput({ requiredPixelCount: 10, targetCompletionMs: 0, effectiveParticipantCount: 1 })).toEqual({
      ok: false,
      reason: 'target_completion_invalid'
    });
    expect(validateProjectPacingInput({ requiredPixelCount: 10, targetCompletionMs: 1000, effectiveParticipantCount: 0 })).toEqual({
      ok: false,
      reason: 'participant_count_invalid'
    });
  });

  it('accrues saved allowance up to the max count and reports the next save time', () => {
    const result = calculateSavedPixelAllowance({
      savedCount: 0,
      lastAccruedAtMs: 0,
      nowMs: 3500,
      allowanceIntervalMs: 1000,
      maxSavedCount: 3
    });

    expect(result).toEqual({
      savedCount: 3,
      nextPixelSavedAtMs: 4000,
      maxStorageEndsAtMs: 3000
    });
  });
});
```

- [ ] **Step 2: Run shared test to verify it fails**

Run:

```bash
npm run test --workspace @pixel-world/shared -- pixelAllowance.test.ts
```

Expected: FAIL because `packages/shared/src/pixelAllowance.ts` does not exist.

- [ ] **Step 3: Implement shared pacing module**

Create `packages/shared/src/pixelAllowance.ts`:

```ts
export const DEFAULT_PROJECT_TARGET_COMPLETION_MS = 6 * 60 * 60 * 1000;
export const MAX_PROJECT_TARGET_COMPLETION_MS = 24 * 60 * 60 * 1000 - 1;
export const DEFAULT_EFFECTIVE_PARTICIPANT_COUNT = 4;
export const DEFAULT_PIXEL_ALLOWANCE_MAX_STORAGE_MS = 30 * 60 * 1000;

export interface RequiredPixelCountInput {
  width: number;
  height: number;
  fixedOrPreFilledPixels?: number;
}

export interface ProjectPacingInput {
  requiredPixelCount: number;
  targetCompletionMs: number;
  effectiveParticipantCount: number;
}

export interface DynamicAllowanceIntervalInput extends ProjectPacingInput {}

export interface MaxSavedPixelCountInput {
  maxStorageMs: number;
  allowanceIntervalMs: number;
}

export interface SavedPixelAllowanceInput {
  savedCount: number;
  lastAccruedAtMs: number;
  nowMs: number;
  allowanceIntervalMs: number;
  maxSavedCount: number;
}

export type ProjectPacingValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'required_pixel_count_invalid' | 'target_completion_invalid' | 'participant_count_invalid';
    };

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function calculateRequiredPixelCount(input: RequiredPixelCountInput): number {
  if (!positiveInteger(input.width) || !positiveInteger(input.height)) {
    return 0;
  }

  const totalPixels = input.width * input.height;
  const fixedPixels = Math.max(0, Math.floor(input.fixedOrPreFilledPixels ?? 0));
  return Math.max(1, totalPixels - fixedPixels);
}

export function validateProjectPacingInput(input: ProjectPacingInput): ProjectPacingValidationResult {
  if (!positiveInteger(input.requiredPixelCount)) {
    return { ok: false, reason: 'required_pixel_count_invalid' };
  }

  if (!positiveInteger(input.targetCompletionMs) || input.targetCompletionMs > MAX_PROJECT_TARGET_COMPLETION_MS) {
    return { ok: false, reason: 'target_completion_invalid' };
  }

  if (!positiveInteger(input.effectiveParticipantCount)) {
    return { ok: false, reason: 'participant_count_invalid' };
  }

  return { ok: true };
}

export function calculateDynamicAllowanceIntervalMs(input: DynamicAllowanceIntervalInput): number {
  const validation = validateProjectPacingInput(input);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  return Math.max(1, Math.ceil((input.targetCompletionMs * input.effectiveParticipantCount) / input.requiredPixelCount));
}

export function calculateMaxSavedPixelCount(input: MaxSavedPixelCountInput): number {
  if (!positiveInteger(input.maxStorageMs) || !positiveInteger(input.allowanceIntervalMs)) {
    return 1;
  }

  return Math.max(1, Math.floor(input.maxStorageMs / input.allowanceIntervalMs));
}

export function calculateSavedPixelAllowance(input: SavedPixelAllowanceInput): {
  savedCount: number;
  nextPixelSavedAtMs: number;
  maxStorageEndsAtMs: number;
} {
  const safeSavedCount = Math.max(0, Math.floor(input.savedCount));
  const safeMaxSavedCount = Math.max(1, Math.floor(input.maxSavedCount));
  const safeIntervalMs = Math.max(1, Math.floor(input.allowanceIntervalMs));
  const elapsedMs = Math.max(0, input.nowMs - input.lastAccruedAtMs);
  const accruedCount = Math.floor(elapsedMs / safeIntervalMs);
  const nextSavedCount = Math.min(safeMaxSavedCount, safeSavedCount + accruedCount);
  const lastAppliedAccrualAtMs = input.lastAccruedAtMs + accruedCount * safeIntervalMs;
  const nextPixelSavedAtMs = nextSavedCount >= safeMaxSavedCount ? input.nowMs + safeIntervalMs : lastAppliedAccrualAtMs + safeIntervalMs;

  return {
    savedCount: nextSavedCount,
    nextPixelSavedAtMs,
    maxStorageEndsAtMs: input.lastAccruedAtMs + safeMaxSavedCount * safeIntervalMs
  };
}
```

Modify `packages/shared/src/index.ts`:

```ts
export * from './colors';
export * from './pixelPolicy';
export * from './socketEvents';
export * from './pixelAllowance';
```

- [ ] **Step 4: Run shared tests**

Run:

```bash
npm run test --workspace @pixel-world/shared -- pixelAllowance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit shared policy**

```bash
git add packages/shared/src/pixelAllowance.ts packages/shared/src/index.ts packages/shared/test/pixelAllowance.test.ts
git commit -m $'Enable project-paced pixel allowance math\n\nConstraint: Pixel projects must finish in short same-day cycles, not fixed global cooldowns.\nRejected: Fixed n-second cooldown | It cannot adapt to map size and participant count.\nConfidence: high\nScope-risk: narrow\nDirective: Keep pacing pure and reusable by future room-scoped implementation.\nTested: npm run test --workspace @pixel-world/shared -- pixelAllowance.test.ts\nNot-tested: Server Redis consumption integration.'
```

---

### Task 2: Add atomic server pixel allowance store

**Files:**
- Create: `apps/server/src/services/pixelAllowanceService.ts`
- Create: `apps/server/test/pixelAllowanceService.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `apps/server/test/pixelAllowanceService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryPixelAllowanceStore, checkAndConsumePixelAllowance } from '../src/services/pixelAllowanceService';

const allowancePolicy = {
  dynamicAllowanceIntervalMs: 1000,
  pixelAllowanceMaxStorageMs: 3000,
  maxSavedPixelCount: 3
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
```

- [ ] **Step 2: Run server store test to verify it fails**

Run:

```bash
npm run test --workspace @pixel-world/server -- pixelAllowanceService.test.ts
```

Expected: FAIL because `pixelAllowanceService.ts` does not exist.

- [ ] **Step 3: Implement in-memory and Redis stores**

Create `apps/server/src/services/pixelAllowanceService.ts`:

```ts
import Redis from 'ioredis';

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
  consumePixelAllowance(
    scopeKey: string,
    actorKey: string,
    nowMs: number,
    policy: PixelAllowancePolicySnapshot
  ): Promise<PixelAllowanceResult>;
}

const CONSUME_PIXEL_ALLOWANCE_SCRIPT = `
local existingSavedCount = redis.call('HGET', KEYS[1], 'savedCount')
local existingLastAccruedAtMs = redis.call('HGET', KEYS[1], 'lastAccruedAtMs')
local nowMs = tonumber(ARGV[1])
local intervalMs = tonumber(ARGV[2])
local maxSavedCount = tonumber(ARGV[3])
local maxStorageMs = tonumber(ARGV[4])
local ttlMs = tonumber(ARGV[5])

local savedCount = tonumber(existingSavedCount)
local lastAccruedAtMs = tonumber(existingLastAccruedAtMs)

if savedCount == nil or lastAccruedAtMs == nil then
  savedCount = 1
  lastAccruedAtMs = nowMs
end

local elapsedMs = math.max(0, nowMs - lastAccruedAtMs)
local accruedCount = math.floor(elapsedMs / intervalMs)
if accruedCount > 0 then
  savedCount = math.min(maxSavedCount, savedCount + accruedCount)
  lastAccruedAtMs = lastAccruedAtMs + accruedCount * intervalMs
end

local nextPixelSavedAtMs = lastAccruedAtMs + intervalMs
local maxStorageEndsAtMs = lastAccruedAtMs + maxStorageMs

if savedCount <= 0 then
  redis.call('HSET', KEYS[1], 'savedCount', savedCount, 'lastAccruedAtMs', lastAccruedAtMs)
  redis.call('PEXPIRE', KEYS[1], ttlMs)
  return {0, savedCount, maxSavedCount, nextPixelSavedAtMs, maxStorageEndsAtMs, math.max(0, nextPixelSavedAtMs - nowMs)}
end

savedCount = savedCount - 1
redis.call('HSET', KEYS[1], 'savedCount', savedCount, 'lastAccruedAtMs', lastAccruedAtMs)
redis.call('PEXPIRE', KEYS[1], ttlMs)
return {1, savedCount, maxSavedCount, nextPixelSavedAtMs, maxStorageEndsAtMs, 0}
`;

function allowanceKey(scopeKey: string, actorKey: string): string {
  return `pixel-allowance:${scopeKey}:${actorKey}`;
}

function normalizePolicy(policy: PixelAllowancePolicySnapshot): PixelAllowancePolicySnapshot {
  return {
    dynamicAllowanceIntervalMs: Math.max(1, Math.floor(policy.dynamicAllowanceIntervalMs)),
    pixelAllowanceMaxStorageMs: Math.max(1, Math.floor(policy.pixelAllowanceMaxStorageMs)),
    maxSavedPixelCount: Math.max(1, Math.floor(policy.maxSavedPixelCount))
  };
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

export class RedisPixelAllowanceStore implements PixelAllowanceStore {
  constructor(private readonly redis: Redis) {}

  async consumePixelAllowance(
    scopeKey: string,
    actorKey: string,
    nowMs: number,
    policy: PixelAllowancePolicySnapshot
  ): Promise<PixelAllowanceResult> {
    const safePolicy = normalizePolicy(policy);
    const ttlMs = Math.max(safePolicy.pixelAllowanceMaxStorageMs * 2, safePolicy.dynamicAllowanceIntervalMs * 2);
    const result = await this.redis.eval(
      CONSUME_PIXEL_ALLOWANCE_SCRIPT,
      1,
      allowanceKey(scopeKey, actorKey),
      nowMs,
      safePolicy.dynamicAllowanceIntervalMs,
      safePolicy.maxSavedPixelCount,
      safePolicy.pixelAllowanceMaxStorageMs,
      ttlMs
    );
    return toPixelAllowanceResult(result);
  }
}

interface InMemoryAllowanceState {
  savedCount: number;
  lastAccruedAtMs: number;
}

export class InMemoryPixelAllowanceStore implements PixelAllowanceStore {
  private readonly values = new Map<string, InMemoryAllowanceState>();
  private readonly locks = new Map<string, Promise<void>>();

  async consumePixelAllowance(
    scopeKey: string,
    actorKey: string,
    nowMs: number,
    policy: PixelAllowancePolicySnapshot
  ): Promise<PixelAllowanceResult> {
    const key = allowanceKey(scopeKey, actorKey);
    return this.withKeyLock(key, () => {
      const safePolicy = normalizePolicy(policy);
      const existing = this.values.get(key) ?? { savedCount: 1, lastAccruedAtMs: nowMs };
      const elapsedMs = Math.max(0, nowMs - existing.lastAccruedAtMs);
      const accruedCount = Math.floor(elapsedMs / safePolicy.dynamicAllowanceIntervalMs);
      const lastAccruedAtMs = existing.lastAccruedAtMs + accruedCount * safePolicy.dynamicAllowanceIntervalMs;
      const savedCount = Math.min(safePolicy.maxSavedPixelCount, existing.savedCount + accruedCount);
      const nextPixelSavedAtMs = lastAccruedAtMs + safePolicy.dynamicAllowanceIntervalMs;
      const maxStorageEndsAtMs = lastAccruedAtMs + safePolicy.pixelAllowanceMaxStorageMs;

      if (savedCount <= 0) {
        this.values.set(key, { savedCount, lastAccruedAtMs });
        return {
          allowed: false,
          savedPixelCount: savedCount,
          maxSavedPixelCount: safePolicy.maxSavedPixelCount,
          nextPixelSavedAtMs,
          maxStorageEndsAtMs,
          remainingMs: Math.max(0, nextPixelSavedAtMs - nowMs)
        };
      }

      const nextSavedCount = savedCount - 1;
      this.values.set(key, { savedCount: nextSavedCount, lastAccruedAtMs });
      return {
        allowed: true,
        savedPixelCount: nextSavedCount,
        maxSavedPixelCount: safePolicy.maxSavedPixelCount,
        nextPixelSavedAtMs,
        maxStorageEndsAtMs,
        remainingMs: 0
      };
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

export async function checkAndConsumePixelAllowance(
  store: PixelAllowanceStore,
  scopeKey: string,
  actorKey: string,
  nowMs: number,
  policy: PixelAllowancePolicySnapshot
): Promise<PixelAllowanceResult> {
  return store.consumePixelAllowance(scopeKey, actorKey, nowMs, policy);
}
```

- [ ] **Step 4: Run server store tests**

Run:

```bash
npm run test --workspace @pixel-world/server -- pixelAllowanceService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit allowance store**

```bash
git add apps/server/src/services/pixelAllowanceService.ts apps/server/test/pixelAllowanceService.test.ts
git commit -m $'Store project-paced pixel allowance atomically\n\nConstraint: Saved pixel actions must be spendable after breaks but cannot accumulate forever.\nRejected: Reusing cooldown-only Redis keys | They store only next availability and cannot represent saved counts.\nConfidence: high\nScope-risk: moderate\nDirective: Keep the store scope key generic so room-scoped pacing can reuse it.\nTested: npm run test --workspace @pixel-world/server -- pixelAllowanceService.test.ts\nNot-tested: Socket.IO placement integration.'
```

---

### Task 3: Load project pacing config and shared socket payloads

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `packages/shared/src/socketEvents.ts`
- Test: `packages/shared/test/pixelAllowance.test.ts`

- [ ] **Step 1: Add tests for default pacing constants already covering 6h and 30m**

Extend `packages/shared/test/pixelAllowance.test.ts` with:

```ts
import { DEFAULT_EFFECTIVE_PARTICIPANT_COUNT } from '../src/pixelAllowance';

it('keeps the planning defaults aligned with the documented same-day project', () => {
  expect(DEFAULT_PROJECT_TARGET_COMPLETION_MS).toBe(21_600_000);
  expect(DEFAULT_PIXEL_ALLOWANCE_MAX_STORAGE_MS).toBe(1_800_000);
  expect(DEFAULT_EFFECTIVE_PARTICIPANT_COUNT).toBe(4);
});
```

- [ ] **Step 2: Run shared tests to verify they pass before config wiring**

Run:

```bash
npm run test --workspace @pixel-world/shared -- pixelAllowance.test.ts
```

Expected: PASS.

- [ ] **Step 3: Modify server config to expose pacing env values**

Modify `apps/server/src/config.ts` imports:

```ts
import {
  DEFAULT_EFFECTIVE_PARTICIPANT_COUNT,
  DEFAULT_PIXEL_ALLOWANCE_MAX_STORAGE_MS,
  DEFAULT_PROJECT_TARGET_COMPLETION_MS,
  createPixelPolicy
} from '@pixel-world/shared';
```

Add helpers below `requireEnv`:

```ts
function optionalPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
```

Extend `ServerConfig`:

```ts
  projectTargetCompletionMs: number;
  projectExpectedParticipants: number;
  pixelAllowanceMaxStorageMs: number;
```

Add fields in `loadConfig()`:

```ts
    projectTargetCompletionMs: optionalPositiveInt('PROJECT_TARGET_COMPLETION_MS', DEFAULT_PROJECT_TARGET_COMPLETION_MS),
    projectExpectedParticipants: optionalPositiveInt('PROJECT_EXPECTED_PARTICIPANTS', DEFAULT_EFFECTIVE_PARTICIPANT_COUNT),
    pixelAllowanceMaxStorageMs: optionalPositiveInt('PIXEL_ALLOWANCE_MAX_STORAGE_MS', DEFAULT_PIXEL_ALLOWANCE_MAX_STORAGE_MS),
```

- [ ] **Step 4: Modify shared Socket.IO payloads**

Modify `packages/shared/src/socketEvents.ts`:

```ts
export interface PixelAllowanceStatePayload {
  targetCompletionMs: number;
  requiredPixelCount: number;
  effectiveParticipantCount: number;
  dynamicAllowanceIntervalMs: number;
  savedPixelCount: number;
  maxSavedPixelCount: number;
  nextPixelSavedAt: string;
  maxStorageEndsAt: string;
}
```

Extend `CanvasSnapshotPayload`:

```ts
  pixelAllowance: PixelAllowanceStatePayload;
```

Keep `CooldownUpdatedPayload` name for compatibility during migration but change its shape:

```ts
export interface CooldownUpdatedPayload extends PixelAllowanceStatePayload {
  remainingMs: number;
}
```

- [ ] **Step 5: Run typecheck for shared and server**

Run:

```bash
npm run typecheck --workspace @pixel-world/shared
npm run typecheck --workspace @pixel-world/server
```

Expected: server may fail until Task 4 updates `socketServer.ts`; shared should pass after local type updates.

- [ ] **Step 6: Commit config and payload contracts after Task 4 passes**

Delay the commit until Task 4 makes server typecheck pass.

---

### Task 4: Integrate allowance into Socket.IO placement

**Files:**
- Modify: `apps/server/src/realtime/socketServer.ts`
- Modify: `apps/server/test/socketServer.test.ts`

- [ ] **Step 1: Add failing socket tests for saved allowance behavior**

Append to `describe('Socket.IO pixel flow', () => { ... })` in `apps/server/test/socketServer.test.ts`:

```ts
  it('allows multiple placements after saved pixel actions accrue', async () => {
    config = {
      ...config,
      projectTargetCompletionMs: 6000,
      projectExpectedParticipants: 1,
      pixelAllowanceMaxStorageMs: 3000
    };
    const url = await startSocketServer();
    const sender = await connectToServer(url);
    await waitForEvent<CanvasSnapshotPayload>(sender, 'canvasSnapshot');

    sender.emit('placePixel', { canvasId: DEFAULT_CANVAS_ID, x: 91, y: 91, colorHex: '#22C55E' });
    await expect(waitForEvent<PixelUpdatedPayload>(sender, 'pixelUpdated')).resolves.toEqual(expect.objectContaining({ x: 91 }));

    await delay(3100);
    sender.emit('placePixel', { canvasId: DEFAULT_CANVAS_ID, x: 92, y: 91, colorHex: '#38BDF8' });
    await expect(waitForEvent<PixelUpdatedPayload>(sender, 'pixelUpdated')).resolves.toEqual(expect.objectContaining({ x: 92 }));
  });

  it('rejects placement with allowance state instead of pressure-heavy cooldown copy', async () => {
    const url = await startSocketServer();
    const sender = await connectToServer(url);
    await waitForEvent<CanvasSnapshotPayload>(sender, 'canvasSnapshot');

    sender.emit('placePixel', { canvasId: DEFAULT_CANVAS_ID, x: 93, y: 91, colorHex: '#22C55E' });
    await waitForEvent<PixelUpdatedPayload>(sender, 'pixelUpdated');

    sender.emit('placePixel', { canvasId: DEFAULT_CANVAS_ID, x: 94, y: 91, colorHex: '#38BDF8' });
    await expect(waitForEvent<PlacementRejectedPayload>(sender, 'placementRejected')).resolves.toEqual(
      expect.objectContaining({
        reason: 'cooldown_active',
        message: 'No saved pixels are ready yet.'
      })
    );
  });
```

- [ ] **Step 2: Run socket tests to verify failure**

Run:

```bash
npm run test --workspace @pixel-world/server -- socketServer.test.ts
```

Expected: FAIL because Socket.IO still uses `checkAndConsumeCooldown` and old payloads.

- [ ] **Step 3: Replace cooldown store wiring with pixel allowance store**

In `apps/server/src/realtime/socketServer.ts`, replace imports:

```ts
import {
  calculateDynamicAllowanceIntervalMs,
  calculateMaxSavedPixelCount,
  calculateRequiredPixelCount,
  DEFAULT_CANVAS_ID,
  normalizeHexColor,
  validateCoordinate,
  type CanvasSnapshotPayload,
  type ClientToServerEvents,
  type CooldownUpdatedPayload,
  type HexColor,
  type PixelAllowanceStatePayload,
  type PixelUpdatedPayload,
  type PlacePixelPayload,
  type PlacementRejectedPayload,
  type PresenceUpdatedPayload,
  type RecentEventsUpdatedPayload,
  type ServerToClientEvents
} from '@pixel-world/shared';
```

Replace cooldown service import:

```ts
import { checkAndConsumePixelAllowance, RedisPixelAllowanceStore, type PixelAllowanceResult } from '../services/pixelAllowanceService';
```

Add helpers near `toCooldownPayload`:

```ts
function getProjectAllowancePolicy(app: FastifyInstance) {
  const requiredPixelCount = calculateRequiredPixelCount({
    width: app.config.policy.width,
    height: app.config.policy.height
  });
  const dynamicAllowanceIntervalMs = calculateDynamicAllowanceIntervalMs({
    targetCompletionMs: app.config.projectTargetCompletionMs,
    effectiveParticipantCount: app.config.projectExpectedParticipants,
    requiredPixelCount
  });
  const maxSavedPixelCount = calculateMaxSavedPixelCount({
    maxStorageMs: app.config.pixelAllowanceMaxStorageMs,
    allowanceIntervalMs: dynamicAllowanceIntervalMs
  });

  return {
    targetCompletionMs: app.config.projectTargetCompletionMs,
    requiredPixelCount,
    effectiveParticipantCount: app.config.projectExpectedParticipants,
    dynamicAllowanceIntervalMs,
    pixelAllowanceMaxStorageMs: app.config.pixelAllowanceMaxStorageMs,
    maxSavedPixelCount
  };
}

function toPixelAllowanceStatePayload(policy: ReturnType<typeof getProjectAllowancePolicy>, result: PixelAllowanceResult): PixelAllowanceStatePayload {
  return {
    targetCompletionMs: policy.targetCompletionMs,
    requiredPixelCount: policy.requiredPixelCount,
    effectiveParticipantCount: policy.effectiveParticipantCount,
    dynamicAllowanceIntervalMs: policy.dynamicAllowanceIntervalMs,
    savedPixelCount: result.savedPixelCount,
    maxSavedPixelCount: result.maxSavedPixelCount,
    nextPixelSavedAt: new Date(result.nextPixelSavedAtMs).toISOString(),
    maxStorageEndsAt: new Date(result.maxStorageEndsAtMs).toISOString()
  };
}

function toAllowanceUpdatedPayload(policy: ReturnType<typeof getProjectAllowancePolicy>, result: PixelAllowanceResult): CooldownUpdatedPayload {
  return {
    ...toPixelAllowanceStatePayload(policy, result),
    remainingMs: result.remainingMs
  };
}
```

- [ ] **Step 4: Consume allowance in placement handler**

Replace:

```ts
const cooldownStore = new RedisCooldownStore(app.redis);
```

with:

```ts
const pixelAllowanceStore = new RedisPixelAllowanceStore(app.redis);
```

Inside `handlePlacePixel`, replace cooldown consume block with:

```ts
        const nowMs = Date.now();
        const projectAllowancePolicy = getProjectAllowancePolicy(app);
        const allowance = await checkAndConsumePixelAllowance(
          pixelAllowanceStore,
          payload.canvasId,
          actorIdentity.actorKey,
          nowMs,
          projectAllowancePolicy
        );

        if (!allowance.allowed) {
          const allowancePayload = toAllowanceUpdatedPayload(projectAllowancePolicy, allowance);
          socket.emit('cooldownUpdated', allowancePayload);
          rejectPlacement(socket, {
            reason: 'cooldown_active',
            message: 'No saved pixels are ready yet.',
            remainingMs: allowance.remainingMs
          });
          return;
        }
```

After successful `upsertPixelAndLog`, replace cooldown update with:

```ts
        const allowanceUpdated = toAllowanceUpdatedPayload(projectAllowancePolicy, allowance);

        io.emit('pixelUpdated', pixelUpdated);
        socket.emit('cooldownUpdated', allowanceUpdated);
```

Remove `consumedCooldownNextAvailableAtMs` release logic. The first implementation accepts that a failed database write may spend one saved action; if that proves unacceptable, add a compensating `refundPixelAllowance` method in a later small task.

- [ ] **Step 5: Send allowance state in initial snapshot**

Before creating `canvasSnapshot`, add:

```ts
      const projectAllowancePolicy = getProjectAllowancePolicy(app);
      const initialAllowance = {
        allowed: true,
        savedPixelCount: 1,
        maxSavedPixelCount: projectAllowancePolicy.maxSavedPixelCount,
        nextPixelSavedAtMs: Date.now() + projectAllowancePolicy.dynamicAllowanceIntervalMs,
        maxStorageEndsAtMs: Date.now() + app.config.pixelAllowanceMaxStorageMs,
        remainingMs: 0
      };
```

Then include:

```ts
        pixelAllowance: toPixelAllowanceStatePayload(projectAllowancePolicy, initialAllowance),
```

Keep `nextAvailableAt` temporarily if existing web code still reads it during the transition.

- [ ] **Step 6: Run server tests and typecheck**

Run:

```bash
npm run test --workspace @pixel-world/server -- pixelAllowanceService.test.ts socketServer.test.ts
npm run typecheck --workspace @pixel-world/server
```

Expected: PASS.

- [ ] **Step 7: Commit Socket.IO allowance integration with Task 3 payload changes**

```bash
git add apps/server/src/config.ts packages/shared/src/socketEvents.ts apps/server/src/realtime/socketServer.ts apps/server/test/socketServer.test.ts
git commit -m $'Consume saved pixel allowance in realtime placement\n\nConstraint: Placement rate must adapt to project size, participant count, and target duration.\nRejected: Cooldown-only placement gate | It cannot store multiple available actions.\nConfidence: medium\nScope-risk: moderate\nDirective: Preserve room-scope compatibility by keeping allowance scope separate from actor identity.\nTested: npm run test --workspace @pixel-world/server -- pixelAllowanceService.test.ts socketServer.test.ts; npm run typecheck --workspace @pixel-world/server\nNot-tested: Browser rendering of allowance status.'
```

---

### Task 5: Show saved pixel allowance in the web UI

**Files:**
- Modify: `apps/web/src/components/StatusBar.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/test/statusBar.test.tsx`
- Modify: `apps/web/test/homePageSocket.test.tsx`

- [ ] **Step 1: Write failing StatusBar tests**

Replace `apps/web/test/statusBar.test.tsx` with:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBar } from '../src/components/StatusBar';

const allowance = {
  savedPixelCount: 2,
  maxSavedPixelCount: 208,
  dynamicAllowanceIntervalMs: 8640,
  nextPixelSavedAt: new Date(Date.now() + 9000).toISOString(),
  maxStorageEndsAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
};

describe('StatusBar', () => {
  afterEach(() => cleanup());

  it('shows saved pixel count instead of cooldown pressure', () => {
    render(createElement(StatusBar, { onlineCount: 3, remainingMs: 0, connected: true, allowance }));

    expect(screen.getByText('2 saved')).toBeVisible();
    expect(screen.getByText(/paced for this project/i)).toBeVisible();
    expect(screen.queryByText('COOLDOWN')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Pixel cooldown' })).not.toBeInTheDocument();
  });

  it('shows calm next saved time when no pixels are ready', () => {
    render(createElement(StatusBar, { onlineCount: 3, remainingMs: 7300, connected: true, allowance: { ...allowance, savedPixelCount: 0 } }));

    expect(screen.getByText('0 saved')).toBeVisible();
    expect(screen.getByText('next in 8s')).toBeVisible();
    expect(screen.queryByText(/use before/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run web StatusBar test to verify failure**

Run:

```bash
npm run test --workspace @pixel-world/web -- statusBar.test.tsx
```

Expected: FAIL because `StatusBar` does not accept `allowance`.

- [ ] **Step 3: Update StatusBar component**

Replace `apps/web/src/components/StatusBar.tsx` with:

```tsx
'use client';

interface StatusBarAllowance {
  savedPixelCount: number;
  maxSavedPixelCount: number;
  dynamicAllowanceIntervalMs: number;
  nextPixelSavedAt: string;
  maxStorageEndsAt: string;
}

interface StatusBarProps {
  onlineCount: number;
  remainingMs: number;
  connected: boolean;
  allowance: StatusBarAllowance | null;
}

function formatNextSavedLabel(remainingMs: number) {
  const safeRemainingMs = Math.max(0, remainingMs);
  if (safeRemainingMs <= 0) {
    return 'ready soon';
  }

  return `next in ${Math.ceil(safeRemainingMs / 1000)}s`;
}

export function StatusBar({ onlineCount, remainingMs, connected, allowance }: StatusBarProps) {
  const savedLabel = allowance ? `${allowance.savedPixelCount} saved` : 'loading';
  const nextSavedLabel = allowance && allowance.savedPixelCount <= 0 ? formatNextSavedLabel(remainingMs) : 'paced for this project';

  return (
    <section className="panel status-bar" aria-label="Canvas status">
      <div className="status-row">
        <span>ONLINE</span>
        <strong>{onlineCount}</strong>
      </div>
      <div className="status-row">
        <span>PIXELS READY</span>
        <strong>{savedLabel}</strong>
      </div>
      <div className="status-row">
        <span>PACE</span>
        <strong>{nextSavedLabel}</strong>
      </div>
      <div className="status-row">
        <span>STATUS</span>
        <strong>{connected ? 'CONNECTED' : 'RECONNECTING'}</strong>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire allowance state in HomePage**

In `apps/web/src/app/page.tsx`, import type:

```ts
  type PixelAllowanceStatePayload,
```

Add state:

```ts
  const [pixelAllowance, setPixelAllowance] = useState<PixelAllowanceStatePayload | null>(null);
```

On snapshot:

```ts
      setPixelAllowance(snapshot.pixelAllowance);
      const nextDeadlineMs = deadlineFromNextAvailableAt(snapshot.pixelAllowance.nextPixelSavedAt);
```

On cooldown update:

```ts
    pixelSocket.on('cooldownUpdated', (allowanceUpdate: CooldownUpdatedPayload) => {
      setPixelAllowance(allowanceUpdate);
      const nextDeadlineMs = deadlineFromNextAvailableAt(allowanceUpdate.nextPixelSavedAt);
      setCooldownDeadlineMs(nextDeadlineMs);
      setRemainingMs(remainingFromDeadline(nextDeadlineMs));
    });
```

Change placement availability:

```tsx
          canPlacePixel={connected && hasSnapshot && (pixelAllowance?.savedPixelCount ?? 0) > 0}
```

Pass prop:

```tsx
          <StatusBar onlineCount={onlineCount} remainingMs={remainingMs} connected={connected} allowance={pixelAllowance} />
```

- [ ] **Step 5: Update home page socket mock snapshot**

In `apps/web/test/homePageSocket.test.tsx`, add `pixelAllowance` to `createSnapshot()`:

```ts
    pixelAllowance: {
      targetCompletionMs: 21_600_000,
      requiredPixelCount: 10_000,
      effectiveParticipantCount: 4,
      dynamicAllowanceIntervalMs: 8640,
      savedPixelCount: 1,
      maxSavedPixelCount: 208,
      nextPixelSavedAt: new Date(Date.now() + 8640).toISOString(),
      maxStorageEndsAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    }
```

- [ ] **Step 6: Run web tests and typecheck**

Run:

```bash
npm run test --workspace @pixel-world/web -- statusBar.test.tsx homePageSocket.test.tsx canvasBoard.test.tsx
npm run typecheck --workspace @pixel-world/web
```

Expected: PASS.

- [ ] **Step 7: Commit UI allowance display**

```bash
git add apps/web/src/components/StatusBar.tsx apps/web/src/app/page.tsx apps/web/test/statusBar.test.tsx apps/web/test/homePageSocket.test.tsx
git commit -m $'Show saved pixel allowance without cooldown pressure\n\nConstraint: The UI must reduce urgency while showing useful project pacing state.\nRejected: Countdown-only status bar | It implies users must return exactly when a timer ends.\nConfidence: medium\nScope-risk: moderate\nDirective: Avoid streak, expiry, and guilt language around saved pixels.\nTested: npm run test --workspace @pixel-world/web -- statusBar.test.tsx homePageSocket.test.tsx canvasBoard.test.tsx; npm run typecheck --workspace @pixel-world/web\nNot-tested: Manual browser smoke test.'
```

---

### Task 6: Documentation and full verification

**Files:**
- Modify: `README.md`
- Verify: all workspaces

- [ ] **Step 1: Add README configuration section**

Add this section to `README.md`:

```md
## Dynamic project pacing

Pixel availability is project-paced instead of a fixed global cooldown.

Formula:

```text
dynamicAllowanceIntervalMs = targetCompletionMs * effectiveParticipantCount / requiredPixelCount
```

Default planning values:

- `PROJECT_TARGET_COMPLETION_MS=21600000` — 6 hours.
- `PROJECT_EXPECTED_PARTICIPANTS=4`
- `PIXEL_ALLOWANCE_MAX_STORAGE_MS=1800000` — 30 minutes.

Example:

```text
100 × 100 = 10,000 pixels
4 participants
6 hours = 21,600 seconds
21,600 * 4 / 10,000 = 8.64 seconds per saved pixel action
30-minute max storage => floor(1,800 / 8.64) = 208 saved actions
```

The UI must not use expiry, streak, or blame language for saved pixels.
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
npm run test --workspace @pixel-world/shared -- pixelAllowance.test.ts
npm run test --workspace @pixel-world/server -- pixelAllowanceService.test.ts socketServer.test.ts
npm run test --workspace @pixel-world/web -- statusBar.test.tsx homePageSocket.test.tsx canvasBoard.test.tsx
```

Expected: all PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run verify
```

Expected: typecheck, unit tests, and build all PASS.

- [ ] **Step 4: Commit docs and verification completion**

```bash
git add README.md
git commit -m $'Document dynamic pixel project pacing\n\nConstraint: Operators need to understand how project size and participant count affect placement rate.\nRejected: Leaving pacing as implicit server defaults | Future changes would reintroduce fixed cooldown assumptions.\nConfidence: high\nScope-risk: narrow\nDirective: Keep examples aligned with shared pacing tests.\nTested: npm run verify\nNot-tested: Production deployment.'
```

---

## Self-review

- Spec coverage: covers dynamic formula, 100×100/4/6h example, saved count cap, no fixed cooldown pressure, no day-long project target, server atomicity, Socket.IO payloads, and UI display.
- Scope control: does not implement rooms, replay, notifications, accounts, streaks, or monetization.
- Test coverage: includes pure math tests, store concurrency tests, socket behavior tests, and UI state tests.
- Known risk: the first implementation spends one saved action before database write success. If placement failures become common, add a refund method in a separate follow-up task.
- Known UX risk: 100×100 with 4 people requires many placements per person, so future implementation should add rapid placement UX if the product expects full-map completion.
