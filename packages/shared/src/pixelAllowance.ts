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

export type DynamicAllowanceIntervalInput = ProjectPacingInput;

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

export interface SavedPixelAllowanceResult {
  savedCount: number;
  lastAccruedAtMs: number;
  nextPixelSavedAtMs: number;
  maxStorageEndsAtMs: number;
}

export function calculateRequiredPixelCount(input: RequiredPixelCountInput): number {
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width <= 0 || input.height <= 0) {
    return 0;
  }

  const totalPixelCount = input.width * input.height;
  const fixedOrPreFilledPixels = Number.isFinite(input.fixedOrPreFilledPixels)
    ? Math.max(0, Math.floor(input.fixedOrPreFilledPixels ?? 0))
    : 0;

  return Math.max(0, totalPixelCount - fixedOrPreFilledPixels);
}

export function validateProjectPacingInput(input: ProjectPacingInput): ProjectPacingValidationResult {
  if (!Number.isInteger(input.requiredPixelCount) || input.requiredPixelCount <= 0) {
    return { ok: false, reason: 'required_pixel_count_invalid' };
  }

  if (
    !Number.isInteger(input.targetCompletionMs) ||
    input.targetCompletionMs <= 0 ||
    input.targetCompletionMs > MAX_PROJECT_TARGET_COMPLETION_MS
  ) {
    return { ok: false, reason: 'target_completion_invalid' };
  }

  if (!Number.isInteger(input.effectiveParticipantCount) || input.effectiveParticipantCount <= 0) {
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
  if (
    !Number.isFinite(input.maxStorageMs) ||
    !Number.isFinite(input.allowanceIntervalMs) ||
    input.maxStorageMs <= 0 ||
    input.allowanceIntervalMs <= 0
  ) {
    return 1;
  }

  return Math.max(1, Math.floor(input.maxStorageMs / input.allowanceIntervalMs));
}

export function calculateSavedPixelAllowance(input: SavedPixelAllowanceInput): SavedPixelAllowanceResult {
  const allowanceIntervalMs = Number.isFinite(input.allowanceIntervalMs)
    ? Math.max(1, Math.floor(input.allowanceIntervalMs))
    : 1;
  const maxSavedCount = Number.isFinite(input.maxSavedCount) ? Math.max(1, Math.floor(input.maxSavedCount)) : 1;
  const savedCount = Number.isFinite(input.savedCount)
    ? Math.min(maxSavedCount, Math.max(0, Math.floor(input.savedCount)))
    : 0;
  const elapsedMs = Math.max(0, input.nowMs - input.lastAccruedAtMs);
  const elapsedIntervals = Math.floor(elapsedMs / allowanceIntervalMs);
  const lastAccruedAtMs = input.lastAccruedAtMs + elapsedIntervals * allowanceIntervalMs;
  const nextIntervalCount = input.nowMs < input.lastAccruedAtMs ? 0 : elapsedIntervals + 1;
  const nextPixelSavedAtMs = input.lastAccruedAtMs + nextIntervalCount * allowanceIntervalMs;

  const accruedSavedCount = Math.min(maxSavedCount, savedCount + elapsedIntervals);

  return {
    savedCount: accruedSavedCount,
    lastAccruedAtMs,
    nextPixelSavedAtMs,
    maxStorageEndsAtMs: lastAccruedAtMs + Math.max(0, maxSavedCount - accruedSavedCount) * allowanceIntervalMs
  };
}
