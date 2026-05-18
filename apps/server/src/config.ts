import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EFFECTIVE_PARTICIPANT_COUNT,
  DEFAULT_PIXEL_ALLOWANCE_MAX_STORAGE_MS,
  DEFAULT_PROJECT_TARGET_COMPLETION_MS,
  createPixelPolicy
} from '@pixel-world/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadLocalEnv(): void {
  const candidates = [join(process.cwd(), '.env'), join(__dirname, '../../../.env')];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

loadLocalEnv();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  throw new Error(`${name} must be a boolean`);
}

export type CookieSameSite = 'lax' | 'strict' | 'none';

function optionalCookieSameSite(name: string, fallback: CookieSameSite): CookieSameSite {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'lax' || normalized === 'strict' || normalized === 'none') {
    return normalized;
  }

  throw new Error(`${name} must be one of: lax, strict, none`);
}

export function resolveUnlimitedPixelPlacement(): boolean {
  return optionalBoolean('PIXEL_ALLOWANCE_UNLIMITED_PLACEMENT', true);
}

export function resolveCookieSettings(nodeEnv: string): {
  secureCookies: boolean;
  cookieSameSite: CookieSameSite;
} {
  const secureCookies = optionalBoolean('COOKIE_SECURE', nodeEnv === 'production');
  const cookieSameSite = optionalCookieSameSite('COOKIE_SAME_SITE', 'lax');

  if (cookieSameSite === 'none' && !secureCookies) {
    throw new Error('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true');
  }

  return { secureCookies, cookieSameSite };
}

export interface ServerConfig {
  nodeEnv: string;
  port: number;
  webOrigin: string;
  databaseUrl: string;
  redisUrl: string;
  cookieSecret: string;
  adminPassword: string;
  ipHashSecret: string;
  secureCookies: boolean;
  cookieSameSite: CookieSameSite;
  projectTargetCompletionMs: number;
  projectExpectedParticipants: number;
  pixelAllowanceMaxStorageMs: number;
  unlimitedPixelPlacement: boolean;
  policy: ReturnType<typeof createPixelPolicy>;
}

export function loadConfig(): ServerConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const cookieSettings = resolveCookieSettings(nodeEnv);

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? '4000'),
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    cookieSecret: requireEnv('COOKIE_SECRET'),
    adminPassword: requireEnv('ADMIN_PASSWORD'),
    ipHashSecret: requireEnv('IP_HASH_SECRET'),
    secureCookies: cookieSettings.secureCookies,
    cookieSameSite: cookieSettings.cookieSameSite,
    projectTargetCompletionMs: optionalPositiveInt('PROJECT_TARGET_COMPLETION_MS', DEFAULT_PROJECT_TARGET_COMPLETION_MS),
    projectExpectedParticipants: optionalPositiveInt('PROJECT_EXPECTED_PARTICIPANTS', DEFAULT_EFFECTIVE_PARTICIPANT_COUNT),
    pixelAllowanceMaxStorageMs: optionalPositiveInt('PIXEL_ALLOWANCE_MAX_STORAGE_MS', DEFAULT_PIXEL_ALLOWANCE_MAX_STORAGE_MS),
    // Initial MVP: keep placement unlimited unless a later rollout explicitly enables time-based limits.
    unlimitedPixelPlacement: resolveUnlimitedPixelPlacement(),
    policy: createPixelPolicy()
  };
}
