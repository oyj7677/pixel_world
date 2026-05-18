# Friend Room MVP Design

Date: 2026-05-17
Status: Approved planning artifact for implementation handoff
Scope: Phase 1 Friend Room MVP, no code changes in this document

## 1. Design decision

Pixel World should move from a public-only realtime canvas toward a friend-room experience. The first product slice is not the full Daily Pixel Log roadmap. It is a narrow validation loop where a user creates a private room, shares an invite link, and friends leave one lightweight pixel trace without account setup.

Canonical loop:

```text
room creation -> invite link -> invite open -> anonymous/guest Quick Pixel -> optional name -> room-scoped realtime update -> basic funnel analytics
```

## 2. Product principles

1. **Friendship before canvas mechanics** — the first screen explains that the user is leaving one small trace for a friend, not joining a drawing tool.
2. **First value before identity** — no account, nickname, profile, contact import, or notification permission before the first pixel succeeds.
3. **One primary action** — invited users see Quick Pixel as the dominant first action.
4. **Saved actions reduce pressure** — pixel availability is shown as saved/ready actions, never as punishment, streak pressure, or expiry shame.
5. **Private room boundaries** — realtime, recent activity, allowance, admin actions, and analytics are scoped to the room/day/canvas.
6. **Additive migration** — existing global canvas data remains safe and readable.

## 3. Users and jobs

### Room creator

- Creates a simple room with only a room name.
- Receives an invite link immediately.
- Understands the room as a light friend activity, not an advanced canvas project.

### Invited friend

- Opens an invite link and understands the action in about 3 seconds.
- Leaves a first pixel in under 10 seconds without identity setup.
- Can optionally add a room-local display name after success.

### Returning participant

- Re-enters the room and sees saved pixel actions, current room activity, and optional manual tools.
- Can continue participating without urgency language.

### Room owner/admin

- Can perform minimal scoped moderation: archive/close room, reset area/canvas, block participant signal, and audit actions.

## 4. Phase 1 scope

### Included

- Private room creation with room name only.
- Invite token generation, copy, landing metadata, revocation support.
- Anonymous actor cookie and room-local guest membership.
- Today-only daily canvas created at room creation.
- Quick Pixel endpoint that chooses or validates a safe server-side position.
- Room-scoped Socket.IO snapshot, pixel, presence, recent-event, allowance, and rejection events.
- Dynamic saved pixel allowance scoped by `room + actor`.
- Optional display name after first pixel success.
- Basic privacy-safe funnel analytics.
- Minimal scoped admin/owner controls.

### Excluded

- Full account system, friend graph, contact import.
- Daily rollover beyond today.
- Replay/share page implementation.
- GIF/MP4 export.
- Push/email/reminder notifications.
- Streaks, missions, badges, rankings, teams, attacks, defense, items, premium prompts.
- Pixelizer/image-template workflows.
- Manual drawing as the first-run primary action.

## 5. Information architecture and routes

| Route | Purpose | First-release behavior |
|---|---|---|
| `/` | Product entry | Room creation landing, with optional link to legacy global canvas if retained. |
| `/r/:roomPublicId` | Room today view | Shows room status, today's canvas, saved pixel actions, activity, and secondary tools. |
| `/r/:roomPublicId/today` | Explicit today alias | Redirects or renders the same room today view. |
| `/invite/:inviteToken` | Invite landing | Shows friend context and one primary Quick Pixel action. |
| `/admin` | Existing admin | Extended only as needed for room-scoped moderation. |

Legacy global canvas behavior must either remain behind a separate link or become a clearly labeled legacy route. It must not be mixed into the first invited friend flow.

## 6. Core user flows

### Flow A — Create room

1. User opens `/`.
2. User enters room name.
3. Server ensures anonymous actor cookie.
4. Server creates room, owner membership, today canvas, default invite token, and pacing snapshot.
5. UI shows invite link and a lightweight explanation.
6. User copies invite link.

Acceptance target: room creation plus invite copy is possible within 30 seconds for a first-time user.

### Flow B — Invite first pixel

1. Friend opens `/invite/:inviteToken`.
2. Server returns landing metadata without requiring signup.
3. UI shows room name, friendly context, and Quick Pixel primary CTA.
4. User taps Quick Pixel.
5. Server validates invite, creates/ensures guest membership, spends or grants first available action, chooses a safe position, persists pixel event, and broadcasts room-scoped update.
6. UI shows success and optional room-local display name prompt.

Acceptance target: median invite-open-to-first-pixel under 10 seconds; Quick Pixel tap-to-success under 3 seconds.

### Flow C — Returning room participation

1. Participant opens `/r/:roomPublicId`.
2. Server validates membership or invite context.
3. UI shows today's room canvas, saved pixel count, room activity, and secondary manual placement tools.
4. Participant can place additional pixels using saved actions.

### Flow D — Room safety

1. Owner/admin opens scoped controls.
2. User chooses archive/reset/block action with reason.
3. Server validates room ownership/admin session.
4. Server writes scoped audit record and emits only affected room/canvas updates.

## 7. System architecture

### Shared package

- Extends current pixel/color/pacing contracts with room-aware IDs.
- Keeps current global contracts compatible until legacy mode is intentionally retired.
- Defines room-aware socket payloads and analytics event names.

### Server package

Suggested modules:

- `src/rooms/roomRoutes.ts` — HTTP routes for room creation, room today, invite landing, Quick Pixel, optional display name, invite revocation/archive.
- `src/rooms/roomRepository.ts` — database access for rooms, members, invites, invite uses, daily canvases.
- `src/rooms/quickPixelService.ts` — server-side placement recommendation, allowance spend, event persistence, analytics trigger.
- `src/rooms/roomAnalytics.ts` — privacy-safe analytics event write boundary.
- `src/realtime/socketServer.ts` — extended to validate room context and join `canvas:<canvasId>` rooms.
- `src/admin/adminRoutes.ts` — extended with scoped room/canvas actions.

### Web package

Suggested route/component split:

- `src/app/page.tsx` — room creation landing, not the full canvas-first experience.
- `src/app/r/[roomPublicId]/page.tsx` — room today page.
- `src/app/invite/[inviteToken]/page.tsx` — invite landing and Quick Pixel first-run flow.
- `src/components/RoomCreateForm.tsx` — room name and invite copy result.
- `src/components/InviteQuickPixel.tsx` — one-primary-action invited flow.
- `src/components/RoomCanvasShell.tsx` — room canvas, saved status, activity, secondary tools.
- `src/components/OptionalNamePrompt.tsx` — post-success display name prompt.

## 8. Data model summary

Phase 1 adds these concepts while preserving existing `canvases`, `pixels`, and `pixel_events`:

- `rooms`: social/private invite-link boundary.
- `room_members`: actor-to-room membership with optional display name.
- `room_invites`: hashed invite token records.
- `room_invite_uses`: invite audit and anti-abuse context without raw IP.
- `daily_canvases`: room/date-to-canvas mapping; today-only active canvas for Phase 1.
- `room_pixel_allowances`: saved pixel action state scoped to room+actor.
- `analytics_events` or equivalent privacy-safe event sink.
- Extended `blocks` and `admin_actions` with scope fields.

The physical pixel surface remains `canvases.id`; authorization and product context come from room/membership/daily-canvas records.

## 9. API contract summary

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/rooms` | Create private room, owner membership, today canvas, default invite. |
| `GET` | `/api/rooms/:roomPublicId/today` | Load room metadata, today canvas, membership, saved allowance. |
| `GET` | `/api/invites/:inviteToken/landing` | Load invite landing metadata and Quick Pixel suggestion. |
| `POST` | `/api/rooms/:roomPublicId/quick-pixel` | Complete Quick Pixel with invite/membership validation. |
| `PATCH` | `/api/rooms/:roomPublicId/me` | Set optional room-local display name after success. |
| `POST` | `/api/rooms/:roomPublicId/invites` | Owner creates another invite. |
| `DELETE` | `/api/rooms/:roomPublicId/invites/:inviteId` | Owner revokes invite. |
| `POST` | `/api/rooms/:roomPublicId/archive` | Owner/admin archives room. |
| `POST` | `/api/rooms/:roomPublicId/admin/reset-area` | Scoped moderation reset. |

All write routes must ensure actor cookie, validate room permission/invite, and return privacy-safe payloads.

## 10. Socket.IO design

Client connection context:

- `roomPublicId`
- `dailyCanvasId` or `date=today`
- optional `inviteToken`
- actor cookie

Server validation:

1. Room exists and is not archived.
2. Daily canvas exists and is active.
3. Actor is member, owner, or has valid invite that can create guest membership.
4. Actor is not globally or room blocked.

Server-side rooms:

```text
room:<roomId>
room:<roomId>:day:<YYYY-MM-DD>
canvas:<canvasId>
```

Pixel updates broadcast to `canvas:<canvasId>`. Recent activity should split personal and room aggregate updates so another room never receives unrelated actor or room events.

## 11. Quick Pixel placement

Phase 1 server placement can be simple and deterministic enough to test:

1. Prefer a suggested coordinate from landing metadata if it is still valid and empty.
2. Otherwise scan the room canvas for the first available coordinate using a stable order seeded by room/day/actor.
3. If the canvas is full, reject with a friendly “today is full” state.
4. Persist through the same atomic pixel write/event path used by manual placement.
5. Broadcast only after persistence succeeds.

This avoids asking first-time invitees to choose coordinates while keeping implementation testable.

## 12. Dynamic saved pixel allowance

Allowance remains project-paced:

```text
dynamicAllowanceIntervalMs = ceil(targetCompletionMs * effectiveParticipantCount / requiredPixelCount)
```

Rules:

- Scope is `room + actor`.
- Required pixels default to `width * height`.
- Default target completion is 6 hours; hard max is under 24 hours.
- Maximum saved count is derived from max storage window, with minimum 1.
- First invited Quick Pixel starts with at least one available action.
- Participant count changes can affect future accrual, but never remove saved actions already earned.

## 13. Analytics and privacy

Minimum Phase-1 events:

- `room_created`
- `invite_link_created`
- `invite_link_copied`
- `invite_landing_viewed`
- `recipient_quick_pixel_started`
- `recipient_first_pixel_completed`
- `recipient_first_pixel_abandoned`
- `optional_display_name_viewed`
- `optional_display_name_set`
- `optional_display_name_skipped`

Do not log raw IP addresses, contacts, full invite URLs, message contents, or exported actor keys. Use room public ID, surface, variant, timing, and coarse color family where needed.

## 14. Error handling

- Invalid invite: show a soft “link is no longer available” page with a path to create a new room.
- Revoked invite: same as invalid, without exposing room details.
- Archived room: show room closed state and no Quick Pixel CTA.
- Full canvas: explain that today’s room is full; offer view-only room state.
- Blocked actor: show neutral unable-to-participate copy.
- Offline after tap: preserve local pending state and retry once; if persistence fails, no success state is shown.
- Cross-room mismatch: server rejects with generic invalid room context and does not join socket rooms.

## 15. Testing strategy

### Unit tests

- Pacing math and max saved count.
- Room public ID and invite token hashing/validation.
- Quick Pixel coordinate selection fallback.
- Privacy-safe analytics serialization.

### Integration tests

- Room creation creates room, owner membership, invite, canvas, and daily canvas.
- Invite landing does not create required nickname/account dependency.
- Quick Pixel with valid invite creates guest membership and pixel event.
- Invalid/revoked invite cannot join or place.
- Room allowance is scoped to room+actor.
- Admin reset/block does not affect other rooms.

### Socket tests

- Same-room participants receive pixel updates.
- Different rooms do not receive each other’s pixel, presence, or recent events.
- Socket join with invalid invite/membership is rejected.

### E2E tests

- Creator creates room, copies invite, invited browser places Quick Pixel anonymously.
- Optional name prompt appears only after success and can be skipped.
- Two rooms are isolated in realtime.
- Legacy global path remains reachable or intentionally redirects according to the final route decision.

## 16. Acceptance criteria

- Room creation with a name returns room public ID and invite URL.
- Invite recipient can complete first pixel without account, nickname, profile, contact import, or notification prompt.
- First invited screen has one primary Quick Pixel action.
- Pixel update is persisted and visible to same-room clients in realtime.
- Other rooms do not receive the update.
- Saved pixel allowance is scoped to room+actor and uses dynamic pacing.
- Optional display name is available only after first success and is not required to keep the pixel.
- Basic funnel analytics are written without disallowed personal data.
- Existing global canvas data is preserved.

## 17. Self-review

- Placeholder scan: no unresolved placeholders remain.
- Internal consistency: Phase 1 is consistently room/invite/Quick Pixel; replay and notifications stay future-only.
- Scope check: the design is broad but implementable as one feature plan because every task supports the same canonical loop.
- Ambiguity check: defaults for room size, identity, routes, daily canvas lifecycle, and allowance scope are fixed for the first implementation.
