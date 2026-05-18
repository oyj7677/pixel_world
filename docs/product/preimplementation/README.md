# Friend Room Pre-Implementation Package

Date: 2026-05-17
Status: Development-ready planning package
Scope: Friend Room Phase 1 only; documentation and planning artifacts before implementation

## Decision

Pixel World의 다음 제품 방향은 기존 공개 `global` 캔버스가 아니라 **친구들과 방을 만들고 초대 링크로 함께 픽셀을 남기는 Friend Room / Daily Pixel Log 방향**이다.

Phase 1에서 구현할 검증 루프는 다음 하나로 제한한다.

```text
room creation -> invite link -> invite open -> anonymous/guest Quick Pixel -> optional name -> room-scoped realtime update -> basic funnel analytics
```

## Current implementation boundary

현재 실행 가능한 앱은 아직 `global` 캔버스 MVP다. Friend Room은 아래 문서 패키지로 개발 전 단계가 정리되었고, 실제 구현은 별도 구현 계획에 따라 진행해야 한다.

- 현재 앱: `global` canvas, Socket.IO realtime, admin tools, saved pixel allowance
- 다음 구현: room, invite, daily canvas, room-scoped Socket.IO, Quick Pixel first-run UX
- 유지할 것: 기존 `canvases`, `pixels`, `pixel_events`, actor cookie, admin audit, shared color/pixel policy
- 분리할 것: global canvas UX와 Friend Room UX. `/`는 landing 또는 legacy global로 유지하고, room flow는 `/r/:roomPublicId`와 `/invite/:inviteToken`으로 분리한다.

## Document map

| Order | Document | Purpose | Status |
|---:|---|---|---|
| 00 | `00-preimplementation-review-criteria.md` | Review criteria and anti-annoyance gate | Accepted |
| 01 | `01-friend-room-mvp-prd.md` | Product requirements and success metrics | Accepted |
| 02 | `02-quick-pixel-ux-spec.md` | First-run and returning-user UX | Accepted |
| 03 | `03-room-daily-canvas-data-model.md` | Room/day data model, API boundaries, Socket.IO scope | Accepted |
| 04 | `04-replay-mvp-tech-design.md` | Phase 2 replay design, explicitly out of Phase 1 | Deferred |
| 05 | `05-invite-share-funnel-experiment-plan.md` | Funnel events and privacy-safe measurement | Accepted for Phase 1 subset |
| 06 | `06-preimplementation-final-review.md` | Cross-document final review and implementation gates | Approved with gates |
| 07 | `07-mvp-contract-appendix.md` | Canonical Phase-1 contract | Canonical |
| 08 | `08-saved-pixel-allowance-design.md` | Dynamic saved pixel allowance design | Accepted |
| 09 | `09-dynamic-project-pacing-test-spec.md` | Test spec for dynamic pacing behavior | Accepted |
| 10 | `10-friend-room-development-readiness.md` | Development readiness checklist and handoff | Current gate |

Related implementation-facing artifacts:

- `docs/superpowers/specs/2026-05-17-friend-room-mvp-design.md`
- `docs/superpowers/plans/2026-05-17-friend-room-mvp-implementation-plan.md`

## Phase 1 product contract

### Included

- Create a private invite-link room with room name only.
- Generate/copy an invite link immediately after room creation.
- Let invited users open the link and place a first Quick Pixel without account, nickname, profile, or notification prompt.
- Create anonymous room-local guest membership when needed.
- Create today’s room-scoped daily canvas when the room is created.
- Use server-side Quick Pixel recommendation/placement so the first action requires no coordinate choice.
- Scope realtime pixel, presence, recent-event, and allowance updates to the current room/day/canvas.
- Use dynamic saved pixel allowance scoped to `room + actor`.
- Allow optional room-local display name only after first pixel success.
- Add privacy-safe funnel analytics for room creation, invite open, Quick Pixel start, first pixel success, optional name, and abandonment.
- Provide minimal room/admin remediation: close/archive room, room-scoped reset/block, and audit records.

### Excluded from Phase 1

- Full account system or friend graph.
- Daily rollover beyond today.
- Replay/share page implementation.
- GIF/MP4 export.
- Push/email/reminder notifications.
- Streaks, missions, rankings, teams, attacks, defense, items, premium prompts.
- Image/template pixelizer flows.
- Large manual drawing workflow before first Quick Pixel.

## Non-negotiable gates

1. **No identity before first value** — invite recipients can complete first pixel anonymously.
2. **No notification prompt before first value** — retention prompts wait until later phases.
3. **One primary action** — first actionable invite screen prioritizes Quick Pixel.
4. **Room isolation** — no cross-room realtime/event leakage.
5. **Saved allowance reduces pressure** — copy says actions are ready/saved, not urgent/expiring.
6. **Privacy-minimal analytics** — no raw IP, contacts, full invite URLs, message contents, or exported actor keys.
7. **Legacy safety** — existing global canvas data is not mutated by the room migration.

## Development entry checklist

Implementation can start when all items are checked:

- [x] Product slice is narrowed to Friend Room + Invite + Quick Pixel + room-scoped realtime + basic analytics.
- [x] Phase 2+ features are explicitly excluded from the first implementation.
- [x] Data model and API boundaries include room, membership, invite, daily canvas, room allowance, and scoped admin actions.
- [x] Socket.IO scoping and cross-room non-delivery tests are required.
- [x] Quick Pixel first-run UX avoids account/nickname/profile/notification setup.
- [x] Dynamic project pacing and saved allowance rules are defined.
- [x] Privacy-safe analytics taxonomy is defined.
- [x] Implementation plan exists with task order and verification commands.

## Stop condition for pre-development work

Pre-development is complete when this package, the design spec, and the implementation plan exist and pass markdown/reference sanity checks. Code implementation starts only in a separate execution lane.
