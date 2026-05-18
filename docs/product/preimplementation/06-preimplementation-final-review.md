# 06. 구현 전 최종 리뷰 및 실행 게이트

Date: 2026-05-16
Status: Ready for implementation planning after reviewer revisions
Scope: Documentation-only handoff before implementation

## 1. Review inputs

This review consolidates the pre-implementation package:

- `00-preimplementation-review-criteria.md`
- `01-friend-room-mvp-prd.md`
- `02-quick-pixel-ux-spec.md`
- `03-room-daily-canvas-data-model.md`
- `04-replay-mvp-tech-design.md`
- `05-invite-share-funnel-experiment-plan.md`
- `07-mvp-contract-appendix.md`
- `08-saved-pixel-allowance-design.md`
- `09-dynamic-project-pacing-test-spec.md`
- `10-friend-room-development-readiness.md`
- `README.md`
- `../../superpowers/specs/2026-05-17-friend-room-mvp-design.md`
- `../../superpowers/plans/2026-05-17-friend-room-mvp-implementation-plan.md`

## 2. Product north star

The project direction is no longer only a public r/place-like canvas. The next product slice is a friend-based Daily Pixel Log where participation feels like leaving one small trace for a friend.

The hard product rule is:

> 사용자가 귀찮다고 느끼면 안 된다.

Implementation must protect this rule more strongly than feature completeness.

## 3. Final pre-implementation verdict

**Verdict:** `APPROVED_WITH_GATES`

The reviewer blockers were resolved by narrowing Phase 1 to the smallest non-annoying friend loop and moving replay/notifications/deeper retention to later phases.

Phase 1 implementation may proceed only against this canonical loop:

```text
room creation -> invite link -> invite open -> anonymous/guest Quick Pixel -> optional name -> room-scoped realtime update -> basic funnel analytics
```

## 4. Non-negotiable implementation gates

1. **No account or nickname before first value**
   A recipient must be able to open an invite and place the first pixel as an anonymous guest. Name/profile/account prompts are optional after success.

2. **No notification prompt before first value**
   Push/email/reminder prompts are excluded from Phase 1. Later alerts must be explicit opt-in friend-activity alerts, not habit pressure.

3. **One primary action after invite landing**
   The first actionable screen must make Quick Pixel the dominant action. It must not ask users to choose coordinates, configure a profile, or learn rules first.

4. **Dynamic saved pixel allowance reduces pressure**
   Pixel opportunities can accumulate up to a maximum storage window so users do not feel forced to return exactly when a timer ends. The rate is calculated from map size, target completion time, and participant count. Unlimited accumulation is not allowed.

5. **Manual drawing is secondary**
   Coordinate picking, large palettes, manual drawing, templates, and advanced tools must not appear before first completion.

6. **Private friend-room scope first**
   Real-time updates, recent events, admin tools, analytics, and future replay must be room/day scoped.

7. **Replay is Phase 2**
   Web replay is planned, but it is not part of the first implementation slice. MP4/GIF export remains out of scope.

8. **Advanced engagement features are gated**
   Streaks, teams, rankings, missions, attacks/defense, items, premium prompts, and growth loops are not allowed in first-run MVP.

## 5. Required decisions before writing code

| Decision | Pre-implementation default |
|---|---|
| Phase 1 product slice | Friend Room + invite + anonymous Quick Pixel + room-scoped realtime + basic analytics |
| Room creation inputs | Room name only |
| Room privacy | Private invite-link room |
| First canvas size | 32×32 unless existing constraints require smaller |
| Daily canvas creation | Create today’s daily canvas when the room is created; no automatic rollover in Phase 1 |
| First recipient identity | Anonymous actor cookie; optional room-local display name after first pixel success |
| Quick Pixel placement | Server chooses a safe available/recommended position |
| Pixel allowance | Dynamic saved count per room+actor, capped by maximum storage time |
| Project duration | Same-day cycle; default target 6 hours; hard max under 24 hours |
| Pacing formula | `targetCompletionMs * effectiveParticipantCount / requiredPixelCount` |
| Quick Pixel color | Calm default color with optional small palette after the primary action |
| Manual placement | Secondary after first pixel succeeds |
| Replay | Phase 2 web replay from sealed daily canvas events |
| Notification experiments | Phase 3 only, after first-pixel and return value are validated |
| Analytics privacy | No raw contacts, raw IPs, message contents, or full invite URLs |

## 6. Recommended implementation sequence

### Phase A — Room/day foundation

- Add room, room member, invite, and today daily canvas concepts.
- Preserve existing canvas/pixel/pixel event model where possible.
- Add room/day authorization boundaries.

### Phase B — Invite and first-run UX

- Create room flow with invite link copy.
- Invite landing page with friend context.
- First-run screen with Quick Pixel as the only primary action.
- Keep nickname optional after success.

### Phase C — Room-scoped real-time canvas

- Scope Socket.IO joins and broadcasts to room/day/canvas.
- Ensure participants in other rooms do not receive unrelated updates.
- Split personal recent events from room recent events.

### Phase D — Quick Pixel completion loop

- Implement server-side safe placement recommendation.
- Show a short success state and optional name prompt.
- Keep share, manual placement, and additional actions low-emphasis after value is visible.

### Phase E — Measurement guardrails

- Add the Phase-1 funnel event taxonomy only.
- Include dynamic saved pixel allowance properties without turning them into streak/urgency mechanics.
- Verify project feasibility for map size, participant count, and target duration before launch.
- Measure invite-open-to-first-pixel, Quick Pixel tap-to-success, abandonment, and annoyance feedback.
- Stop or revise if annoyance guardrails fail.

### Phase F — Later phases, not first implementation

- Phase 2: daily rollover, sealed canvases, web replay/share page.
- Phase 3: optional friend-activity alerts and retention experiments.
- Phase 4+: advanced collaboration/interference systems only after the low-friction loop is proven.

## 7. Cross-document consistency matrix

| Topic | PRD | UX | Data/API | Replay | Experiment | Contract | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| Friend room first | Yes | Yes | Yes | Yes | Yes | Yes | Aligned |
| Anonymous first pixel | Yes | Yes | Yes | N/A | Yes | Yes | Aligned |
| Optional name after success | Yes | Yes | Yes | Yes | Yes | Yes | Aligned |
| Quick Pixel primary | Yes | Yes | Yes | N/A | Yes | Yes | Aligned |
| Manual tools secondary | Yes | Yes | N/A | N/A | Yes | Yes | Aligned |
| Room/day scope | Yes | Partial | Yes | Yes | Yes | Yes | Aligned |
| Daily lifecycle | Phase 1 today only | N/A | Yes | Phase 2 | Phase gated | Yes | Aligned |
| Replay | Non-goal for Phase 1 | N/A | Phase 2-ready | Phase 2 | Phase 2+ | Yes | Aligned |
| Notification delay | Yes | Yes | N/A | N/A | Yes | Yes | Aligned |
| Privacy minimization | Yes | Yes | Yes | Yes | Yes | Yes | Aligned |
| Advanced features gated | Yes | Yes | N/A | Yes | Yes | Yes | Aligned |

## 8. Review feedback integration log

### Product/UX critic revisions applied

- Resolved identity conflict: first pixel no longer requires nickname/account/profile.
- Unified timing ladder: understand action in about 3 seconds, invite-open-to-first-pixel median under 10 seconds, Quick Pixel tap-to-success median under 3 seconds; 60 seconds is diagnostic failure ceiling only.
- Split scope: Friend Room Quick Pixel is Phase 1; replay, notifications, and retention systems are later phases.
- Added share guardrails: share/invite is not primary immediately after first pixel and dismissal must be durable.
- Reframed notifications as optional friend-activity alerts, not habit-formation pressure.

### Technical architect revisions applied

- Defined smallest MVP slice and moved daily rollover/replay to Phase 2.
- Added daily canvas lifecycle defaults: today canvas on room creation, no automatic rollover in Phase 1, lazy seal/replay-ready in Phase 2.
- Clarified Socket.IO room/day/canvas scoping and cross-room non-delivery test requirement.
- Added replay DTO/privacy contract for Phase 2.
- Added canonical Phase-1 analytics event taxonomy and moved notification events to Phase 3.

## 9. Known risks to carry into implementation planning

1. **Scope creep risk** — the full roadmap is broad; implementation must start with Friend Room + Quick Pixel only.
2. **Anonymous ownership risk** — anonymous room owners may lose access if cookies are cleared; later account claiming may be needed.
3. **Invite abuse risk** — private rooms still need revocation and scoped moderation early.
4. **Replay privacy risk** — public share links must not accidentally expose private room metadata in Phase 2.
5. **Analytics overreach risk** — measurement must not collect unnecessary personal data.
6. **UX pressure risk** — streaks/reminders can increase retention but must wait until the non-annoying loop is proven.

## 10. Implementation-plan entry checklist

Before implementation planning starts, confirm:

- [x] Reviewer feedback in this file is resolved or explicitly accepted as a known risk.
- [x] The MVP is limited to Friend Room + Invite + anonymous Quick Pixel + room-scoped realtime + basic funnel analytics.
- [x] No notification, streak, team, item, premium, replay export, or video feature is included in the first implementation plan.
- [x] The first-run flow can be tested against the 3-second comprehension and 10-second invite-to-first-pixel targets.
- [x] Room/day authorization and Socket.IO scoping are included in the test plan.
- [x] Privacy-friendly analytics properties are fixed before instrumentation.
- [x] Dynamic saved pixel allowance and maximum storage time are defined as pressure-reduction mechanics.
- [x] Project pacing formula is defined for map size, participant count, and target duration.
- [x] Development readiness index and implementation plan are written.

## 11. Self-review

- This final review preserves the core anti-annoyance rule as a gate, not a preference.
- It separates Phase 1 implementation from the full future roadmap.
- It resolves reviewer-identified contradictions around identity, timing, replay, notifications, analytics scope, and dynamic saved pixel allowance pressure.
- It gives the next implementation plan a narrow, testable phase order.
- It points to `07-mvp-contract-appendix.md` as the canonical implementation contract.
