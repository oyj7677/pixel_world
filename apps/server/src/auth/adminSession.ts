import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'pw_admin';
const MAX_CLOCK_SKEW_MS = 60_000;
const HMAC_SHA256_HEX = /^[a-f0-9]{64}$/;
const MAX_PASSWORD_LENGTH = 4096;

function signIssuedAt(issuedAt: string, secret: string): string {
  return createHmac('sha256', secret).update(issuedAt).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

export function createAdminSessionToken(secret: string): string {
  const issuedAt = Date.now().toString();
  const signature = signIssuedAt(issuedAt, secret);
  return `${issuedAt}.${signature}`;
}

export function verifyAdminSessionToken(
  token: string | undefined,
  secret: string,
  maxAgeMs: number
): boolean {
  if (!token) {
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return false;
  }

  const [issuedAtRaw, signature] = parts;
  if (!issuedAtRaw || !signature || !/^\d+$/.test(issuedAtRaw) || !HMAC_SHA256_HEX.test(signature)) {
    return false;
  }

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isSafeInteger(issuedAt)) {
    return false;
  }

  const now = Date.now();
  if (issuedAt > now + MAX_CLOCK_SKEW_MS) {
    return false;
  }

  if (now - issuedAt > maxAgeMs) {
    return false;
  }

  return safeEqual(signature, signIssuedAt(issuedAtRaw, secret));
}

function sha256Digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function isCorrectAdminPassword(input: string, expected: string): boolean {
  if (input.length > MAX_PASSWORD_LENGTH) {
    return false;
  }

  return timingSafeEqual(sha256Digest(input), sha256Digest(expected));
}
