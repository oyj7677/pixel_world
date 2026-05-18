import { describe, expect, it, vi } from 'vitest';
import {
  ACTOR_COOKIE,
  getOrSetActorKey,
  getRequestIp,
  hashIpAddress,
  isValidActorKey,
  readSignedActorCookie
} from '../src/auth/actorIdentity';

describe('actor identity', () => {
  it('accepts generated actor keys and rejects unsafe values', () => {
    expect(isValidActorKey('act_0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isValidActorKey('')).toBe(false);
    expect(isValidActorKey('../bad')).toBe(false);
  });

  it('hashes IP addresses with a secret without exposing the raw IP', () => {
    const hash = hashIpAddress('203.0.113.8', 'secret-a');
    expect(hash).not.toContain('203.0.113.8');
    expect(hash).toHaveLength(64);
    expect(hashIpAddress('203.0.113.8', 'secret-a')).toBe(hash);
    expect(hashIpAddress('203.0.113.8', 'secret-b')).not.toBe(hash);
  });

  it('reads only valid signed actor cookies', () => {
    const validActorKey = 'act_0123456789abcdef0123456789abcdef';
    const unsigned = vi.fn((value: string) => ({ valid: true as const, renew: false, value }));
    const tampered = vi.fn(() => ({ valid: false, renew: false, value: null }) as const);

    expect(readSignedActorCookie({ [ACTOR_COOKIE]: validActorKey }, unsigned)).toBe(validActorKey);
    expect(readSignedActorCookie({ [ACTOR_COOKIE]: '../bad' }, unsigned)).toBeUndefined();
    expect(readSignedActorCookie({ [ACTOR_COOKIE]: validActorKey }, tampered)).toBeUndefined();
    expect(readSignedActorCookie({}, unsigned)).toBeUndefined();
  });

  it('accepts an existing valid signed actor cookie without replacing it', () => {
    const actorKey = 'act_0123456789abcdef0123456789abcdef';
    const request = {
      cookies: { [ACTOR_COOKIE]: 'signed-cookie-value' },
      unsignCookie: vi.fn(() => ({ valid: true as const, renew: false, value: actorKey }))
    };
    const reply = { setCookie: vi.fn() };

    expect(getOrSetActorKey(request as never, reply as never)).toBe(actorKey);
    expect(reply.setCookie).not.toHaveBeenCalled();
  });

  it('rejects unsigned or tampered actor cookies and replaces them with a signed cookie', () => {
    const request = {
      cookies: { [ACTOR_COOKIE]: 'act_0123456789abcdef0123456789abcdef' },
      unsignCookie: vi.fn(() => ({ valid: false, renew: false, value: null }) as const)
    };
    const reply = { setCookie: vi.fn() };

    const actorKey = getOrSetActorKey(request as never, reply as never);

    expect(actorKey).toMatch(/^act_[a-f0-9]{32}$/);
    expect(actorKey).not.toBe(request.cookies[ACTOR_COOKIE]);
    expect(reply.setCookie).toHaveBeenCalledWith(
      ACTOR_COOKIE,
      actorKey,
      expect.objectContaining({ signed: true, httpOnly: true, sameSite: 'lax', path: '/' })
    );
  });

  it('can mark replacement actor cookies as secure for production HTTPS deployments', () => {
    const request = {
      cookies: {},
      unsignCookie: vi.fn()
    };
    const reply = { setCookie: vi.fn() };

    getOrSetActorKey(request as never, reply as never, { secureCookie: true });

    expect(reply.setCookie).toHaveBeenCalledWith(
      ACTOR_COOKIE,
      expect.stringMatching(/^act_[a-f0-9]{32}$/),
      expect.objectContaining({ secure: true })
    );
  });

  it('uses Fastify request.ip instead of trusting x-forwarded-for directly', () => {
    const request = {
      headers: { 'x-forwarded-for': '198.51.100.10' },
      ip: '10.0.0.5'
    };

    expect(getRequestIp(request as never)).toBe('10.0.0.5');
  });
});
