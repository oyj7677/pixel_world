# 10. Friend Room Development Readiness

Date: 2026-05-17
Status: Ready for implementation lane
Scope: Development-readiness gate for Friend Room Phase 1

## 1. Readiness verdict

**Verdict:** `READY_FOR_IMPLEMENTATION_WITH_SCOPE_GATES`

The Friend Room direction is decided and the development-preparation package is complete enough to hand to an implementation agent/team. The current runnable app is still the global canvas MVP, so the first implementation must be an additive migration that keeps legacy global behavior safe while introducing room-scoped flows.

## 2. Final Phase-1 target

Build the smallest version of:

```text
private friend room -> invite link -> invited guest opens link -> Quick Pixel succeeds anonymously -> optional display name -> room-scoped realtime update -> privacy-safe analytics event
```

The product promise is:

> 친구에게 오늘의 흔적 픽셀 하나를 남긴다.

## 3. Fixed implementation defaults

| Topic | Default |
|---|---|
| Room creation input | `name` only |
| Room privacy | Private invite-link room |
| Room URL | `/r/:roomPublicId` |
| Invite URL | `/invite/:inviteToken` |
| Phase-1 canvas lifecycle | Create today’s active daily canvas at room creation |
| Phase-1 canvas size | `32 × 32` |
| Default color | `#FFFFFF` |
| First recipient identity | Anonymous actor cookie + room-local guest membership |
| First value action | Quick Pixel, server chooses safe available coordinate |
| Optional identity | Room-local display name after first pixel success |
| Allowance scope | `room + actor` |
| Default target completion | 6 hours |
| Hard max project target | Under 24 hours |
| Default expected participants | 4 unless room creation later collects a different value |
| Max allowance storage | 30 minutes |
| Existing global canvas | Preserve as legacy/landing path; do not mutate data |

## 4. Required implementation surfaces

### Shared package

- Extend room-aware event/payload contracts.
- Keep existing global canvas contracts compatible until legacy mode is intentionally retired.
- Reuse color and dynamic allowance math.

### Server

- Add room/membership/invite/daily-canvas migrations.
- Add repository/service boundaries for rooms, invites, daily canvases, room allowances, and analytics events.
- Add public routes for room creation, invite landing, room today, Quick Pixel, optional display name, and invite revocation/archive where scoped owner controls require them.
- Scope admin and block logic to global or room.
- Scope Socket.IO joins and broadcasts to `canvas:<canvasId>` and verify room membership/invite before connection.

### Web

- Add home/landing room creation flow.
- Add invite landing screen with one primary Quick Pixel action.
- Add room page with today's canvas, saved pixel status, room activity, optional name prompt, and secondary manual tools only after first value.
- Keep admin/moderation tools out of first-run invited flow.

### E2E and verification

- Two-room isolation test.
- Anonymous invite-to-first-pixel test.
- Optional display-name-after-success test.
- Invalid/revoked invite test.
- Saved allowance scoped by room+actor test.
- Legacy global smoke test or redirect/landing decision test.

## 5. Required evidence before implementation is considered complete

- `npm run typecheck` passes.
- `npm run test` passes.
- `npm run build` passes.
- `npm run e2e` covers room creation, invite entry, Quick Pixel, and room isolation.
- A targeted Socket.IO integration test proves Room A does not receive Room B updates.
- A migration test proves existing `global` canvas rows are not deleted or rewritten.
- Analytics test proves events omit raw IP, full invite URL, contacts, message contents, and exported actor keys.

## 6. Risk register for implementers

| Risk | Mitigation |
|---|---|
| Scope creep from full Daily Pixel Log roadmap | Keep Phase 1 to room/invite/Quick Pixel only. |
| Owner loses anonymous room control after cookie deletion | Accept as Phase-1 limitation; add owner recovery/account claim only after value loop is validated. |
| Invite tokens leak | Store token hashes only, support revocation, avoid logging full invite URLs. |
| Cross-room realtime leak | Use membership/invite validation before socket join and add non-delivery tests. |
| UX becomes too much like drawing homework | Hide manual tools until first Quick Pixel succeeds. |
| Saved allowance feels like an expiry/streak mechanic | Use “saved/ready pixel actions” copy, avoid penalty language. |
| Global canvas migration corrupts old data | Additive migration only; no destructive rewrite. |

## 7. Handoff artifacts

Implementation should start from:

1. `docs/product/preimplementation/README.md`
2. `docs/product/preimplementation/07-mvp-contract-appendix.md`
3. `docs/superpowers/specs/2026-05-17-friend-room-mvp-design.md`
4. `docs/superpowers/plans/2026-05-17-friend-room-mvp-implementation-plan.md`

## 8. Self-review

- The readiness gate matches the newer friend-room direction and does not claim the feature already exists.
- The plan protects existing global canvas data.
- Phase 1 is small enough to implement and test independently.
- The anti-annoyance rule remains a launch gate, not a nice-to-have.
