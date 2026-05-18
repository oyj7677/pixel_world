import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EFFECTIVE_PARTICIPANT_COUNT,
  DEFAULT_PIXEL_ALLOWANCE_MAX_STORAGE_MS,
  DEFAULT_PROJECT_TARGET_COMPLETION_MS,
  calculateDynamicAllowanceIntervalMs,
  calculateMaxSavedPixelCount,
  calculateRequiredPixelCount,
  calculateSavedPixelAllowance,
  validateProjectPacingInput
} from '../src/pixelAllowance';

describe('dynamic project pacing', () => {
  it('keeps the planning defaults aligned with the documented same-day project', () => {
    expect(DEFAULT_PROJECT_TARGET_COMPLETION_MS).toBe(21_600_000);
    expect(DEFAULT_PIXEL_ALLOWANCE_MAX_STORAGE_MS).toBe(1_800_000);
    expect(DEFAULT_EFFECTIVE_PARTICIPANT_COUNT).toBe(4);
  });

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
      lastAccruedAtMs: 3000,
      nextPixelSavedAtMs: 4000,
      maxStorageEndsAtMs: 3000
    });
  });

  it('clamps already saved allowance when a policy cap decreases', () => {
    const result = calculateSavedPixelAllowance({
      savedCount: 5,
      lastAccruedAtMs: 0,
      nowMs: 5000,
      allowanceIntervalMs: 1000,
      maxSavedCount: 3
    });

    expect(result).toEqual({
      savedCount: 3,
      lastAccruedAtMs: 5000,
      nextPixelSavedAtMs: 6000,
      maxStorageEndsAtMs: 5000
    });
  });

  it('reports when partially saved allowance would become full without more placements', () => {
    const result = calculateSavedPixelAllowance({
      savedCount: 2,
      lastAccruedAtMs: 0,
      nowMs: 500,
      allowanceIntervalMs: 1000,
      maxSavedCount: 5
    });

    expect(result).toEqual({
      savedCount: 2,
      lastAccruedAtMs: 0,
      nextPixelSavedAtMs: 1000,
      maxStorageEndsAtMs: 3000
    });
  });

  it('does not double-count elapsed intervals when repeated calls reuse the returned accrual anchor', () => {
    const first = calculateSavedPixelAllowance({
      savedCount: 0,
      lastAccruedAtMs: 0,
      nowMs: 2500,
      allowanceIntervalMs: 1000,
      maxSavedCount: 10
    });

    const second = calculateSavedPixelAllowance({
      savedCount: first.savedCount,
      lastAccruedAtMs: first.lastAccruedAtMs,
      nowMs: 3500,
      allowanceIntervalMs: 1000,
      maxSavedCount: 10
    });

    expect(first).toEqual({
      savedCount: 2,
      lastAccruedAtMs: 2000,
      nextPixelSavedAtMs: 3000,
      maxStorageEndsAtMs: 10000
    });
    expect(second).toEqual({
      savedCount: 3,
      lastAccruedAtMs: 3000,
      nextPixelSavedAtMs: 4000,
      maxStorageEndsAtMs: 10000
    });
  });
});
