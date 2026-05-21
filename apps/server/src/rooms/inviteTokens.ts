import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const DEFAULT_INVITE_TOKEN_BYTE_LENGTH = 12;

function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function generateInviteToken(byteLength = DEFAULT_INVITE_TOKEN_BYTE_LENGTH): string {
  return toBase64Url(randomBytes(byteLength));
}

export function hashInviteToken(rawToken: string, secret: string): string {
  return createHmac('sha256', secret).update(rawToken).digest('hex');
}

export function verifyInviteToken(rawToken: string, storedHash: string, secret: string): boolean {
  const candidateHash = hashInviteToken(rawToken, secret);
  const candidate = Buffer.from(candidateHash, 'hex');
  const stored = Buffer.from(storedHash, 'hex');

  if (candidate.length !== stored.length) {
    return false;
  }

  return timingSafeEqual(candidate, stored);
}
