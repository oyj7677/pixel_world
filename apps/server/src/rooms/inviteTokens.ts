import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const DEFAULT_INVITE_TOKEN_BYTE_LENGTH = 12;
export const INVITE_CODE_LENGTH = 4;

const INVITE_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function generateInviteToken(byteLength = DEFAULT_INVITE_TOKEN_BYTE_LENGTH): string {
  return toBase64Url(randomBytes(byteLength));
}

export function generateInviteCode(length = INVITE_CODE_LENGTH): string {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)]!;
  }
  return code;
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
