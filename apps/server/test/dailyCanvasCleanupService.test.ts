import { describe, expect, it } from 'vitest';
import { millisecondsUntilNextKoreanMidnight } from '../src/services/dailyCanvasCleanupService';

describe('daily canvas cleanup scheduler', () => {
  it('schedules cleanup at the next 00:00 Korea time', () => {
    expect(millisecondsUntilNextKoreanMidnight(new Date('2026-05-21T14:30:00.000Z'))).toBe(30 * 60 * 1000);
  });

  it('waits until the following midnight when already at 00:00 Korea time', () => {
    expect(millisecondsUntilNextKoreanMidnight(new Date('2026-05-21T15:00:00.000Z'))).toBe(24 * 60 * 60 * 1000);
  });
});
