import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CookieSameSite } from '../config';

export const ACTOR_COOKIE = 'pw_actor';
const ACTOR_KEY_PATTERN = /^act_[a-f0-9]{32}$/;

type CookieMap = Record<string, string | undefined>;
type UnsignResult =
  | { valid: true; renew: boolean; value: string }
  | { valid: false; renew: false; value: null };
type UnsignCookie = (value: string) => UnsignResult;

export function createActorKey(): string {
  return `act_${randomBytes(16).toString('hex')}`;
}

export function isValidActorKey(value: string | undefined): value is string {
  return typeof value === 'string' && ACTOR_KEY_PATTERN.test(value);
}

export function readSignedActorCookie(cookies: CookieMap, unsignCookie: UnsignCookie): string | undefined {
  const signedValue = cookies[ACTOR_COOKIE];
  if (!signedValue) {
    return undefined;
  }

  const unsigned = unsignCookie(signedValue);
  if (!unsigned.valid || !isValidActorKey(unsigned.value)) {
    return undefined;
  }

  return unsigned.value;
}

export interface ActorCookieOptions {
  secureCookie?: boolean;
  sameSite?: CookieSameSite;
}

export function getOrSetActorKey(
  request: FastifyRequest,
  reply: FastifyReply,
  options: ActorCookieOptions = {}
): string {
  const existing = readSignedActorCookie(request.cookies, request.unsignCookie.bind(request));
  if (existing) {
    return existing;
  }

  const actorKey = createActorKey();
  reply.setCookie(ACTOR_COOKIE, actorKey, {
    httpOnly: true,
    sameSite: options.sameSite ?? 'lax',
    path: '/',
    signed: true,
    secure: options.secureCookie === true,
    maxAge: 60 * 60 * 24 * 365
  });
  return actorKey;
}

export function hashIpAddress(ipAddress: string, secret: string): string {
  return createHmac('sha256', secret).update(ipAddress).digest('hex');
}

export function getRequestIp(request: FastifyRequest): string {
  return request.ip;
}
