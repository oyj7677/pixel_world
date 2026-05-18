# Friend Room MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase-1 friend-room loop: room creation, invite link, anonymous Quick Pixel, optional name, room-scoped realtime update, and privacy-safe analytics.

**Architecture:** Add room/day/invite concepts around the existing canvas and pixel event model instead of replacing it. Keep the current `global` canvas as legacy-safe behavior while new routes and APIs operate on room-scoped daily canvases. Reuse existing actor cookies, pixel persistence, Socket.IO publication, color policy, admin audit, and dynamic saved pixel allowance math.

**Tech Stack:** TypeScript, Next.js/React, Fastify, Socket.IO, PostgreSQL, Redis, Vitest, Playwright.

---

## Implementation scope

This plan implements only the canonical Phase-1 loop:

```text
room creation -> invite link -> invite open -> anonymous/guest Quick Pixel -> optional name -> room-scoped realtime update -> basic funnel analytics
```

Out of scope for this implementation: account system, friend graph, daily rollover beyond today, replay page, GIF/MP4 export, notifications, streaks, teams, items, premium prompts, image pixelizer, and advanced drawing-first UX.

## Source documents

- `docs/product/preimplementation/README.md`
- `docs/product/preimplementation/07-mvp-contract-appendix.md`
- `docs/product/preimplementation/10-friend-room-development-readiness.md`
- `docs/superpowers/specs/2026-05-17-friend-room-mvp-design.md`

## Files and responsibilities

### Shared contracts

- Modify: `packages/shared/src/socketEvents.ts` — room-aware payload fields and room-specific recent-event channels.
- Modify: `packages/shared/src/index.ts` — exports for room contract modules.
- Create: `packages/shared/src/roomContracts.ts` — API DTOs, analytics event names, room route constants, and validation helpers.
- Create: `packages/shared/test/roomContracts.test.ts` — contract and validation tests.

### Server persistence and services

- Create: `apps/server/migrations/002_friend_rooms.sql` — additive room, invite, daily canvas, room allowance, analytics, and scoped admin fields.
- Create: `apps/server/src/rooms/roomRepository.ts` — rooms, members, invites, invite uses, daily canvases, analytics events.
- Create: `apps/server/src/rooms/inviteTokens.ts` — raw token generation and hash validation.
- Create: `apps/server/src/rooms/quickPixelService.ts` — room validation, guest membership, safe position choice, allowance spend, pixel persistence, broadcast payload.
- Create: `apps/server/src/rooms/roomRoutes.ts` — HTTP API routes.
- Create: `apps/server/src/rooms/roomAnalytics.ts` — privacy-safe analytics boundary.
- Modify: `apps/server/src/app.ts` — register room routes.
- Modify: `apps/server/src/realtime/socketServer.ts` — validate room join context and scope broadcasts.
- Modify: `apps/server/src/admin/adminRoutes.ts` — room-scoped reset/block/archive path.

### Server tests

- Create: `apps/server/test/roomRepository.test.ts`
- Create: `apps/server/test/roomRoutes.test.ts`
- Create: `apps/server/test/quickPixelService.test.ts`
- Create: `apps/server/test/roomSocketIsolation.test.ts`
- Modify: `apps/server/test/adminRoutes.test.ts`

### Web routes and components

- Modify: `apps/web/src/app/page.tsx` — replace canvas-first entry with room creation landing or clearly link legacy global canvas.
- Create: `apps/web/src/app/r/[roomPublicId]/page.tsx` — room today page.
- Create: `apps/web/src/app/invite/[inviteToken]/page.tsx` — invite landing page.
- Create: `apps/web/src/components/RoomCreateForm.tsx`
- Create: `apps/web/src/components/InviteQuickPixel.tsx`
- Create: `apps/web/src/components/RoomCanvasShell.tsx`
- Create: `apps/web/src/components/OptionalNamePrompt.tsx`
- Create: `apps/web/src/lib/roomApi.ts`
- Modify: `apps/web/src/lib/socketClient.ts` if room connection parameters are not already supported.

### Web and E2E tests

- Create: `apps/web/test/roomCreateForm.test.tsx`
- Create: `apps/web/test/inviteQuickPixel.test.tsx`
- Create: `apps/web/test/roomCanvasShell.test.tsx`
- Create: `apps/e2e/tests/friend-room.spec.ts`

### Documentation

- Modify: `README.md` — mark Friend Room as implemented when complete and update route/testing instructions.
- Modify: `docs/product/preimplementation/10-friend-room-development-readiness.md` only if implementation changes a fixed default.

---

## Task 1: Shared room contracts

**Files:**
- Create: `packages/shared/src/roomContracts.ts`
- Modify: `packages/shared/src/socketEvents.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/roomContracts.test.ts`

- [ ] **Step 1: Write contract tests**

Create tests that prove:

```ts
import {
  FRIEND_ROOM_CANVAS_SIZE,
  FRIEND_ROOM_ROUTES,
  isValidRoomName,
  privacySafeAnalyticsEventNames
} from '../src/roomContracts';

describe('room contracts', () => {
  it('fixes the Phase-1 canvas size at 32 by 32', () => {
    expect(FRIEND_ROOM_CANVAS_SIZE).toEqual({ width: 32, height: 32 });
  });

  it('accepts short human room names and rejects empty names', () => {
    expect(isValidRoomName('Mina birthday')).toBe(true);
    expect(isValidRoomName('')).toBe(false);
    expect(isValidRoomName('   ')).toBe(false);
  });

  it('defines stable public routes for room and invite flows', () => {
    expect(FRIEND_ROOM_ROUTES.room('abc123')).toBe('/r/abc123');
    expect(FRIEND_ROOM_ROUTES.invite('token123')).toBe('/invite/token123');
  });

  it('keeps analytics event names in the Phase-1 privacy-safe set', () => {
    expect(privacySafeAnalyticsEventNames).toContain('room_created');
    expect(privacySafeAnalyticsEventNames).toContain('recipient_first_pixel_completed');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test --workspace @pixel-world/shared -- roomContracts.test.ts`

Expected: FAIL because `roomContracts.ts` does not exist.

- [ ] **Step 3: Add shared room contract module**

Implement constants and DTO types:

- `FRIEND_ROOM_CANVAS_SIZE = { width: 32, height: 32 }`
- `FRIEND_ROOM_DEFAULT_TARGET_COMPLETION_MS = 6 * 60 * 60 * 1000`
- `FRIEND_ROOM_MAX_TARGET_COMPLETION_MS = 24 * 60 * 60 * 1000 - 1`
- `FRIEND_ROOM_ROUTES.room(publicId)`
- `FRIEND_ROOM_ROUTES.invite(token)`
- `isValidRoomName(name)` trims and accepts 1..80 chars
- API DTOs for create room, invite landing, quick pixel, optional display name
- analytics event union with only Phase-1 events

- [ ] **Step 4: Extend Socket.IO payload contracts**

Add optional room fields to pixel payloads while keeping legacy global clients compatible:

- `roomPublicId?: string`
- `dailyCanvasId?: string`
- `roomRecentEventsUpdated`
- `myRecentEventsUpdated`

- [ ] **Step 5: Export and verify**

Run:

```bash
npm run test --workspace @pixel-world/shared -- roomContracts.test.ts
npm run typecheck --workspace @pixel-world/shared
```

Expected: PASS.

- [ ] **Step 6: Commit**

Commit intent: `Define shared contracts for friend-room boundaries`.

---

## Task 2: Additive room database migration and repository

**Files:**
- Create: `apps/server/migrations/002_friend_rooms.sql`
- Create: `apps/server/src/rooms/roomRepository.ts`
- Create: `apps/server/src/rooms/inviteTokens.ts`
- Test: `apps/server/test/roomRepository.test.ts`

- [ ] **Step 1: Write repository tests**

Tests must prove:

- creating a room creates owner membership, invite hash, low-level canvas, and today daily canvas;
- raw invite token is never stored;
- existing `global` canvas still exists after migration;
- invite revocation prevents future validation;
- `room_members` is unique by `room_id + actor_key`.

Use test names:

```ts
it('creates a private room with owner membership, invite, canvas, and today daily canvas')
it('stores only invite token hash')
it('does not delete or rewrite the legacy global canvas')
it('rejects a revoked invite token')
it('upserts room membership by room and actor')
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test --workspace @pixel-world/server -- roomRepository.test.ts`

Expected: FAIL because migration/repository do not exist.

- [ ] **Step 3: Write additive migration**

Create tables:

- `rooms`
- `room_members`
- `room_invites`
- `room_invite_uses`
- `daily_canvases`
- `room_pixel_allowances`
- `analytics_events`

Extend existing tables additively:

- `blocks.scope_type`, `blocks.room_id`
- `admin_actions.scope_type`, `admin_actions.room_id`, `admin_actions.daily_canvas_id`, `admin_actions.canvas_id`, `admin_actions.actor_key`
- optional `canvases.kind`

Migration must not update or delete existing `canvases`, `pixels`, or `pixel_events` rows.

- [ ] **Step 4: Implement token utilities**

`inviteTokens.ts` responsibilities:

- generate high-entropy URL-safe raw token;
- hash token using existing server secret material or a dedicated invite hash helper;
- compare raw token to stored hash with timing-safe comparison where practical;
- never return stored hash to API consumers.

- [ ] **Step 5: Implement repository methods**

Repository methods:

- `createRoomWithTodayCanvas(input)`
- `getRoomToday(publicId)`
- `createInvite(roomId, createdByMemberId)`
- `validateInvite(rawToken)`
- `revokeInvite(inviteId, actorKey)`
- `ensureRoomMember(roomId, actorKey, role, inviteId?)`
- `recordInviteUse(inviteId, roomId, actorKey, actorIpHash)`
- `appendAnalyticsEvent(event)`

- [ ] **Step 6: Verify migration and repository**

Run:

```bash
npm run migrate
npm run test --workspace @pixel-world/server -- roomRepository.test.ts
```

Expected: migration succeeds and tests PASS.

- [ ] **Step 7: Commit**

Commit intent: `Add room persistence without mutating global canvas data`.

---

## Task 3: Room HTTP API

**Files:**
- Create: `apps/server/src/rooms/roomRoutes.ts`
- Create: `apps/server/src/rooms/roomAnalytics.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/roomRoutes.test.ts`

- [ ] **Step 1: Write route tests**

Tests must prove:

```ts
it('creates a room from a name only and returns an invite URL')
it('loads invite landing metadata without requiring nickname')
it('rejects invalid invite tokens without leaking private room details')
it('sets optional display name only after membership exists')
it('records privacy-safe analytics events without raw IP or full invite URL')
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test --workspace @pixel-world/server -- roomRoutes.test.ts`

Expected: FAIL because routes are not registered.

- [ ] **Step 3: Implement `POST /api/rooms`**

Behavior:

- validates `name` with shared contract;
- ensures actor cookie using existing actor identity helpers;
- creates room, owner membership, today's canvas, default invite;
- appends `room_created`, `invite_link_created` analytics events;
- returns `roomPublicId`, `roomName`, `todayDailyCanvasId`, `canvasId`, `inviteUrl`.

- [ ] **Step 4: Implement `GET /api/invites/:inviteToken/landing`**

Behavior:

- validates token hash;
- rejects revoked/expired invite with generic response;
- returns room name, room public id, today canvas metadata, Quick Pixel suggestion, and no private internals.

- [ ] **Step 5: Implement `PATCH /api/rooms/:roomPublicId/me`**

Behavior:

- requires existing room membership;
- accepts empty or 1..40 char room-local display name;
- never required for keeping previous pixels.

- [ ] **Step 6: Register routes and verify**

Run:

```bash
npm run test --workspace @pixel-world/server -- roomRoutes.test.ts
npm run typecheck --workspace @pixel-world/server
```

Expected: PASS.

- [ ] **Step 7: Commit**

Commit intent: `Expose private room and invite HTTP boundaries`.

---

## Task 4: Quick Pixel service and room allowance

**Files:**
- Create: `apps/server/src/rooms/quickPixelService.ts`
- Modify: `apps/server/src/services/pixelAllowanceService.ts`
- Test: `apps/server/test/quickPixelService.test.ts`

- [ ] **Step 1: Write service tests**

Tests must prove:

```ts
it('places first invited Quick Pixel without nickname or account')
it('creates guest membership when invite is valid')
it('chooses a safe fallback coordinate when the suggestion is unavailable')
it('rejects placement when room is archived')
it('spends allowance scoped to room and actor')
it('does not remove already saved actions when participant count changes')
it('returns a friendly full-canvas rejection when no coordinate is available')
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test --workspace @pixel-world/server -- quickPixelService.test.ts`

Expected: FAIL because quick pixel service does not exist.

- [ ] **Step 3: Generalize allowance scope**

Current allowance keys already use a `scopeKey`. Ensure room use passes a stable room/daily scope such as `room:${roomId}` or `canvas:${canvasId}` according to the chosen repository boundary. Tests must show global and room allowances do not collide.

- [ ] **Step 4: Implement coordinate selection**

Algorithm:

1. Use suggested coordinate when valid, within bounds, and empty.
2. Otherwise derive deterministic scan offset from `roomId + canvasDate + actorKey`.
3. Scan every coordinate once.
4. Return first empty coordinate.
5. Return full-canvas rejection if none exists.

- [ ] **Step 5: Implement `POST /api/rooms/:roomPublicId/quick-pixel` path**

The route may live in `roomRoutes.ts`, but business logic stays in `quickPixelService.ts`. Behavior:

- validate invite or membership;
- ensure guest membership;
- ensure first invited Quick Pixel has at least one available action;
- spend allowance;
- persist pixel through existing atomic `upsertPixelAndLog`;
- append analytics event;
- return pixel and allowance payload;
- ask realtime layer to broadcast only after persistence succeeds.

- [ ] **Step 6: Verify**

Run:

```bash
npm run test --workspace @pixel-world/server -- quickPixelService.test.ts
npm run test --workspace @pixel-world/server -- pixelAllowanceService.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Commit intent: `Make Quick Pixel the anonymous first room action`.

---

## Task 5: Room-scoped Socket.IO realtime

**Files:**
- Modify: `apps/server/src/realtime/socketServer.ts`
- Test: `apps/server/test/roomSocketIsolation.test.ts`
- Modify: `apps/server/test/socketServer.test.ts`

- [ ] **Step 1: Write socket isolation tests**

Tests must prove:

```ts
it('lets same-room clients receive room pixel updates')
it('prevents Room A clients from receiving Room B pixel updates')
it('prevents cross-room presence leakage')
it('rejects socket join without membership or valid invite')
it('keeps legacy global canvas socket behavior working')
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test --workspace @pixel-world/server -- roomSocketIsolation.test.ts`

Expected: FAIL because socket join is still global-only.

- [ ] **Step 3: Add room join context**

Socket handshake/query must accept:

- `roomPublicId`
- `dailyCanvasId` or `date=today`
- optional `inviteToken`

Server validates room/day/membership before joining room-specific socket rooms.

- [ ] **Step 4: Split broadcast targets**

- Legacy global canvas continues to use existing path.
- Room pixel updates broadcast to `canvas:<canvasId>` only.
- Room recent activity emits `roomRecentEventsUpdated`.
- Personal recent activity emits `myRecentEventsUpdated`.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test --workspace @pixel-world/server -- roomSocketIsolation.test.ts
npm run test --workspace @pixel-world/server -- socketServer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Commit intent: `Isolate realtime updates by room canvas`.

---

## Task 6: Web room creation and invite-first UX

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/r/[roomPublicId]/page.tsx`
- Create: `apps/web/src/app/invite/[inviteToken]/page.tsx`
- Create: `apps/web/src/components/RoomCreateForm.tsx`
- Create: `apps/web/src/components/InviteQuickPixel.tsx`
- Create: `apps/web/src/components/OptionalNamePrompt.tsx`
- Create: `apps/web/src/lib/roomApi.ts`
- Test: `apps/web/test/roomCreateForm.test.tsx`
- Test: `apps/web/test/inviteQuickPixel.test.tsx`

- [ ] **Step 1: Write component tests**

Tests must prove:

```tsx
it('creates a room from room name only and shows invite link')
it('renders invite landing with one primary Quick Pixel action')
it('does not render nickname, profile, contact, or notification prompts before Quick Pixel success')
it('shows optional name prompt after Quick Pixel success')
it('shows invalid invite as a closed friendly state')
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test --workspace @pixel-world/web -- roomCreateForm.test.tsx inviteQuickPixel.test.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement `roomApi.ts`**

Functions:

- `createRoom({ name })`
- `getInviteLanding(inviteToken)`
- `placeQuickPixel(roomPublicId, payload)`
- `updateRoomDisplayName(roomPublicId, displayName)`
- `getRoomToday(roomPublicId)`

- [ ] **Step 4: Implement room creation landing**

`/` should prioritize room creation. If legacy global remains accessible, render it as a secondary link with copy such as “Open legacy global canvas.”

- [ ] **Step 5: Implement invite landing**

Invite screen requirements:

- room name visible;
- one primary Quick Pixel button;
- no nickname/profile/notification prompt before success;
- short low-pressure copy;
- friendly invalid/revoked invite state.

- [ ] **Step 6: Implement optional name prompt**

Prompt appears after Quick Pixel success and can be skipped. Skipping must not undo the pixel.

- [ ] **Step 7: Verify**

Run:

```bash
npm run test --workspace @pixel-world/web -- roomCreateForm.test.tsx inviteQuickPixel.test.tsx
npm run typecheck --workspace @pixel-world/web
```

Expected: PASS.

- [ ] **Step 8: Commit**

Commit intent: `Put Quick Pixel before identity in friend invites`.

---

## Task 7: Room today page, admin scope, and analytics visibility

**Files:**
- Create: `apps/web/src/components/RoomCanvasShell.tsx`
- Modify: `apps/web/src/components/CanvasBoard.tsx`
- Modify: `apps/web/src/components/StatusBar.tsx`
- Modify: `apps/web/src/components/RecentEvents.tsx`
- Modify: `apps/web/src/components/AdminPanel.tsx`
- Modify: `apps/server/src/admin/adminRoutes.ts`
- Test: `apps/web/test/roomCanvasShell.test.tsx`
- Modify: `apps/server/test/adminRoutes.test.ts`

- [ ] **Step 1: Write tests**

Tests must prove:

```tsx
it('shows saved pixel actions without urgent expiry copy')
it('hides manual tools until first value is complete for invited users')
it('shows room recent activity separately from personal recent activity')
it('allows room-scoped admin reset without affecting another room')
it('writes admin audit records with room and canvas scope')
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test --workspace @pixel-world/web -- roomCanvasShell.test.tsx
npm run test --workspace @pixel-world/server -- adminRoutes.test.ts
```

Expected: new tests fail until room shell/admin scope exists.

- [ ] **Step 3: Implement room canvas shell**

Room page shows:

- today's room canvas;
- saved pixel action count;
- room activity;
- secondary manual placement after first value;
- no streak, mission, premium, or notification prompt.

- [ ] **Step 4: Extend admin scope**

Admin routes must accept room/canvas scope for room reset/block/archive while keeping global behavior intact. Audit rows include `scope_type`, `room_id`, `daily_canvas_id`, `canvas_id`, and reason.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test --workspace @pixel-world/web -- roomCanvasShell.test.tsx
npm run test --workspace @pixel-world/server -- adminRoutes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Commit intent: `Scope room activity and moderation to friend rooms`.

---

## Task 8: End-to-end validation and documentation

**Files:**
- Create: `apps/e2e/tests/friend-room.spec.ts`
- Modify: `README.md`
- Modify: `docs/product/preimplementation/10-friend-room-development-readiness.md` if a fixed default changed during implementation.

- [ ] **Step 1: Write E2E tests**

E2E scenarios:

```ts
it('creator creates room and invitee leaves anonymous Quick Pixel')
it('optional display name appears only after first pixel success')
it('two rooms do not receive each other realtime pixel updates')
it('invalid invite cannot place a pixel')
it('legacy global route remains available or redirects intentionally')
```

- [ ] **Step 2: Run E2E to verify failure or target gaps**

Run after local services are up:

```bash
docker compose up -d db redis
npm run migrate
npm run dev:server
npm run dev:web
npm run e2e -- friend-room.spec.ts
```

Expected before final integration: tests fail on missing pieces. Expected at task completion: PASS.

- [ ] **Step 3: Update README**

README must include:

- room creation URL;
- invite URL shape;
- admin route notes;
- verification commands;
- explicit note that global canvas is legacy or secondary.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run typecheck
npm run test
npm run build
npm run e2e
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit intent: `Verify the friend-room MVP loop end to end`.

---

## Final acceptance checklist

- [ ] `POST /api/rooms` creates room, owner membership, today daily canvas, and invite link.
- [ ] `/invite/:inviteToken` allows first Quick Pixel without account/nickname/profile/contact/notification prompts.
- [ ] Quick Pixel persists a valid pixel and broadcasts only to same room/canvas clients.
- [ ] `/r/:roomPublicId` shows room today state, saved actions, and room activity.
- [ ] Optional display name is after-success only and skippable.
- [ ] Saved allowance is scoped to `room + actor` and uses dynamic project pacing.
- [ ] Invalid or revoked invite cannot place or join.
- [ ] Room A and Room B do not receive each other’s realtime updates.
- [ ] Admin reset/block/archive actions are scoped and audited.
- [ ] Analytics omit raw IP, contacts, full invite URLs, message contents, and exported actor keys.
- [ ] Existing `global` canvas data is not deleted or rewritten.
- [ ] Full verification commands pass.

## Self-review against spec

- Spec coverage: every Phase-1 requirement maps to at least one task.
- Placeholder scan: no task depends on undefined future phases.
- Type consistency: route names, room IDs, invite tokens, daily canvas IDs, and allowance payloads match the design spec.
- Scope control: replay, notifications, accounts, friend graph, premium, and pixelizer remain out of implementation scope.
