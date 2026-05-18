# 07. Phase-1 MVP Contract Appendix

Date: 2026-05-16  
Status: Canonical contract for implementation planning  
Scope: Phase 1 only

## 1. Canonical Phase-1 loop

```text
room creation -> invite link -> invite open -> anonymous/guest Quick Pixel -> optional name -> room-scoped realtime update -> basic funnel analytics
```

Anything outside this loop is not part of the first implementation plan unless explicitly re-approved.

## 2. Anti-annoyance timing ladder

| Moment | Target | Meaning |
|---|---:|---|
| Invite landing comprehension | ~3 seconds | User understands “my friend saved a spot; I can leave one pixel.” |
| Invite open to first pixel success | median < 10 seconds | Full first value is fast enough to feel light. |
| Quick Pixel tap to success feedback | median < 3 seconds | The action feels immediate. |
| Saved pixel allowance comprehension | one short line | User understands how many pixel actions are ready and that there is no rush. |
| Project pacing feasibility | before start | Creator can see whether map size + participant count can finish within target duration. |
| Any first-run session over 60 seconds | diagnostic failure ceiling | Trigger observation/interview; do not count as product success. |

## 3. Identity contract

- The server may create an anonymous actor cookie before first pixel.
- The server may create a room-local `guest` membership before first pixel.
- The UI must not require nickname, account creation, email, phone, password, profile image, contact import, or notification permission before first pixel.
- After success, the UI may ask: “Want your friend to know it was you?”
- Display name is optional, room-local, editable later, and never treated as a global account.

## 4. Minimal API contract

### `POST /api/rooms`

Owner action. Creates a private friend room.

Request:

- `name`

Response:

- `roomPublicId`
- `roomName`
- `todayDailyCanvasId`
- `canvasId`
- `inviteUrl`

Rules:

- No mode, size, template, notification, or monetization setup in Phase 1.
- Creates owner membership for the current anonymous actor.
- Creates today’s daily canvas immediately.

### `GET /api/invites/:inviteToken/landing`

Recipient landing metadata.

Response:

- `roomPublicId`
- `roomName`
- inviter/friend context when available
- today canvas preview metadata
- `quickPixelSuggestion`

Rules:

- Must not create pressure to sign up.
- Must not reveal private room internals beyond invite landing needs.

### `POST /api/rooms/:roomPublicId/quick-pixel`

Recipient first value action.

Request:

- `inviteToken` when recipient is not already a member
- optional client hint: `suggestedColorHex`; server may override

Response:

- `accepted: true`
- `roomPublicId`
- `dailyCanvasId`
- `canvasId`
- `x`
- `y`
- `colorHex`
- `targetCompletionMs`
- `requiredPixelCount`
- `effectiveParticipantCount`
- `dynamicAllowanceIntervalMs`
- `savedPixelCount`
- `maxSavedPixelCount`
- `nextPixelSavedAt`
- `maxStorageEndsAt`
- `optionalNamePrompt: true | false`

Rules:

- Validates invite or existing membership.
- Creates anonymous guest membership if needed.
- Chooses/validates a safe available pixel server-side.
- Emits room-scoped realtime update only after persistence succeeds.

### `PATCH /api/rooms/:roomPublicId/me`

Optional post-success identity.

Request:

- `displayName` optional room-local name

Rules:

- Must be callable after first pixel.
- Must not be required to keep the placed pixel.


## 5. Dynamic project pacing and pixel allowance contract

Phase 1 should use project-paced saved pixel allowance instead of a pressure-heavy pure cooldown. The rate is not fixed globally. It is derived from the size of the current project, its target completion time, and participant count.

Rules:

- One saved pixel action lets the actor place one pixel in the room/project.
- Allowance scope is `room + actor`, not global.
- A pixel project must not target longer than one day. Default target is a same-day 6-hour project window.
- Required pixels default to `width * height`; future templates can subtract fixed/pre-filled pixels.
- Dynamic interval formula: `dynamicAllowanceIntervalMs = targetCompletionMs * effectiveParticipantCount / requiredPixelCount`.
- Allowance is capped by `pixelAllowanceMaxStorageMs`.
- Maximum saved count is derived from `floor(pixelAllowanceMaxStorageMs / dynamicAllowanceIntervalMs)`, minimum 1.
- When the cap is reached, additional time does not create more saved actions. The UI should frame this as “saved up to the limit,” not as punishment or loss.
- If participant count changes, future accrual may be recalculated, but already saved actions are not removed.
- First invited Quick Pixel starts with at least one available action.
- No streak, penalty, or urgent expiry copy is allowed in Phase 1.

Recommended planning defaults:

- `targetCompletionMs`: 6 hours.
- hard max `targetCompletionMs`: under 24 hours.
- `pixelAllowanceMaxStorageMs`: 30 minutes or about 10% of target duration, whichever is more appropriate for the project.
- If the computed interval becomes too short to use comfortably, the project should suggest a smaller map, more participants, or fast multi-place UX instead of pressuring users.

Example:

```text
map = 100 × 100 = 10,000 required pixels
participants = 4
target = 6 hours = 21,600 seconds
per participant target = 2,500 pixels
dynamic interval = 21,600 * 4 / 10,000 = 8.64 seconds per saved pixel action
30-minute max storage => floor(1,800 / 8.64) = 208 saved actions max per participant
```

This example is feasible mathematically, but it is intense if every pixel requires a careful click. Implementation planning should pair this pacing with rapid placement UX, drag placement, or batch Quick Pixel spending if the project expects full-map completion.

## 6. Socket.IO contract

### Handshake / join context

Client supplies:

- `roomPublicId`
- `dailyCanvasId` or `date=today`
- actor cookie
- optional `inviteToken` for first-time recipient

Server validates:

1. room exists,
2. daily canvas exists and is active,
3. actor is a room member or invite token can create guest membership,
4. actor is not globally or room blocked.

### Server-side rooms

```text
room:<roomId>
room:<roomId>:day:<YYYY-MM-DD>
canvas:<canvasId>
```

Pixel updates broadcast only to:

```text
canvas:<canvasId>
```

### Event payloads

`pixelUpdated` must include:

- `roomPublicId`
- `dailyCanvasId`
- `canvasId`
- `x`
- `y`
- `colorHex`
- `updatedAt`

Recent activity is split:

- `myRecentEventsUpdated`: only current actor’s own recent history.
- `roomRecentEventsUpdated`: only current room/day aggregate activity.

## 7. Daily canvas lifecycle contract

Phase 1:

- Room creation creates today’s daily canvas immediately.
- Only today is required.
- No automatic daily rollover.
- Replay endpoints are not required.

Phase 2:

- Lazy rollover may create a new active daily canvas on first access of a new room-local date.
- Previous active canvas becomes `sealed`.
- Replay cache/build can transition sealed canvas to `replay_ready`.
- Sealed/replay_ready canvases are read-only except scoped admin restoration.

Timezone:

- Store room timezone from creator locale when available.
- Fall back to UTC when unknown.

## 8. Phase-1 analytics taxonomy

| Event | Trigger | Required privacy-safe properties |
|---|---|---|
| `room_created` | Room is created | `room_public_id`, `source`, `room_privacy` |
| `invite_link_created` | Invite token generated | `room_public_id`, `invite_variant` |
| `invite_link_copied` | Creator copies invite | `room_public_id`, `surface` |
| `invite_landing_viewed` | Recipient opens invite | `room_public_id`, `landing_variant`, `referrer_type` |
| `recipient_quick_pixel_started` | Recipient taps/starts Quick Pixel | `room_public_id`, `landing_variant` |
| `recipient_first_pixel_completed` | First pixel persists | `room_public_id`, `completion_ms`, `color_family`, `saved_count_before` |
| `recipient_first_pixel_abandoned` | Recipient exits/times out after starting | `room_public_id`, `abandon_step` |
| `optional_display_name_viewed` | Name prompt shown after success | `room_public_id`, `surface` |
| `optional_display_name_set` | User adds room-local name | `room_public_id`, `surface` |
| `optional_display_name_skipped` | User stays anonymous | `room_public_id`, `surface` |

Do not log:

- raw contacts,
- raw IP addresses,
- message contents,
- full invite URLs,
- actor keys in product analytics exports.

## 9. Minimum test matrix for implementation planning

| Area | Required test |
|---|---|
| Identity | Invite recipient can complete first pixel without nickname/account/profile. |
| Timing | Instrument invite-open-to-first-pixel and Quick Pixel tap-to-success durations. |
| Room isolation | Two rooms connected simultaneously do not receive each other’s pixel/presence/recent events. |
| Invite privacy | Invalid/revoked invite cannot join private room. |
| Recent events | Personal recent history remains actor-local; room recent history remains room/day-scoped. |
| Dynamic pacing | 100×100 map, 4 participants, 6-hour target computes about 8.64 seconds per saved action. |
| Saved allowance | Saved pixel allowance is scoped to actor + room, capped by max storage time, and never shown as urgent pressure. |
| Admin safety | Room-scoped reset/block actions do not affect other rooms. |
| Analytics privacy | No raw IP, contact, full invite URL, or message content in events. |
| Migration | Existing global canvas remains readable or is redirected without data mutation. |
| Future replay | Pixel events remain append-only and ordered for future replay. |

## 10. Phase-2+ boundary

The following are planned but outside Phase 1:

- daily rollover beyond today,
- replay web share page,
- GIF/MP4 export,
- notifications/reminders,
- streaks or daily obligations,
- teams, attacks, defenses, and items,
- premium rooms,
- contact import/friend graph,
- image/template pixelizer flows.

## 11. Self-review

- Contract resolves identity-before-value conflict.
- Contract defines the smallest API/socket/data/analytics surface needed before implementation planning.
- Contract keeps replay and notifications available as future phases without letting them creep into Phase 1.
- Contract turns the anti-annoyance principle into measurable gates.
- Contract adds dynamic project-paced saved pixel allowance with maximum storage time to reduce return-pressure without allowing infinite accumulation.
