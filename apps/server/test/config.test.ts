import { afterEach, describe, expect, it } from 'vitest';
import { resolveCookieSettings, resolveUnlimitedPixelPlacement } from '../src/config';

const ENV_KEYS = [
  'PIXEL_ALLOWANCE_UNLIMITED_PLACEMENT',
  'COOKIE_SECURE',
  'COOKIE_SAME_SITE',
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const original = originalEnv[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

describe('server config deployment defaults', () => {
  afterEach(() => restoreEnv());

  it('keeps initial MVP pixel placement unlimited even in production unless explicitly disabled', () => {
    delete process.env.PIXEL_ALLOWANCE_UNLIMITED_PLACEMENT;

    expect(resolveUnlimitedPixelPlacement()).toBe(true);
  });

  it('allows explicitly disabling unlimited placement for a later time-limited rollout', () => {
    process.env.PIXEL_ALLOWANCE_UNLIMITED_PLACEMENT = 'false';

    expect(resolveUnlimitedPixelPlacement()).toBe(false);
  });

  it('defaults production cookies to secure same-site lax', () => {
    delete process.env.COOKIE_SECURE;
    delete process.env.COOKIE_SAME_SITE;

    expect(resolveCookieSettings('production')).toEqual({
      secureCookies: true,
      cookieSameSite: 'lax',
    });
  });

  it('supports explicit cross-site cookie settings for split web/API deployments', () => {
    process.env.COOKIE_SECURE = 'true';
    process.env.COOKIE_SAME_SITE = 'none';

    expect(resolveCookieSettings('production')).toEqual({
      secureCookies: true,
      cookieSameSite: 'none',
    });
  });

  it('rejects SameSite=None without secure cookies', () => {
    process.env.COOKIE_SECURE = 'false';
    process.env.COOKIE_SAME_SITE = 'none';

    expect(() => resolveCookieSettings('development')).toThrow(/COOKIE_SAME_SITE=none requires COOKIE_SECURE=true/);
  });
});
