# 09. Dynamic Project Pacing Test Spec

Date: 2026-05-16  
Status: Implementation-entry test contract  
Scope: Dynamic saved pixel allowance before room/replay/notification work

## 1. Claim to prove

Pixel placement rate is no longer a fixed global cooldown. It is calculated from project size, target completion time, and participant count, while unused placement opportunities can be saved up to a capped maximum storage window.

## 2. Required formula checks

- `100×100`, 4 participants, 6-hour target produces `8.64s` per saved pixel action.
- 30-minute max storage with `8.64s` interval produces `208` max saved actions.
- Required pixel count is `width * height` unless fixed/pre-filled pixels are explicitly subtracted.
- Invalid required pixel count, target time, or participant count is rejected before being used by placement logic.

## 3. Required server behavior checks

- First placement for an actor/project scope is allowed.
- Immediate second placement is rejected when no saved actions are available.
- After enough time passes, additional saved actions can be spent.
- Saved count never exceeds `maxSavedPixelCount`.
- Allowance is scoped by project/canvas and actor, not globally.
- Concurrent placement attempts spend at most one saved action when only one is available.
- Rejection copy says no saved pixels are ready yet; it must not use streak, blame, or expiry pressure.

## 4. Required Socket.IO checks

- Initial `canvasSnapshot` includes pixel allowance state.
- Successful placement emits updated allowance state.
- Rejected placement emits remaining time and allowance state.
- Existing invalid color, invalid coordinate, block, and snapshot queue behavior still works.
- Recent events remain actor-local as previously decided.

## 5. Required web UI checks

- Status bar displays saved pixel count.
- Status bar displays calm next-save timing when count is zero.
- Status bar does not show a cooldown progress bar.
- Canvas placement is enabled when `savedPixelCount > 0`.
- Canvas inspection remains available even when placement is unavailable.

## 6. Required verification commands

```bash
npm run test --workspace @pixel-world/shared -- pixelAllowance.test.ts
npm run test --workspace @pixel-world/server -- pixelAllowanceService.test.ts socketServer.test.ts
npm run test --workspace @pixel-world/web -- statusBar.test.tsx homePageSocket.test.tsx canvasBoard.test.tsx
npm run verify
```

## 7. Stop conditions

Do not proceed to room/replay/notification implementation until:

- all targeted tests pass,
- `npm run verify` passes,
- the UI no longer depends on fixed cooldown wording,
- the 100×100 / 4 / 6h example remains covered by an automated test.

## 8. Self-review

- The spec checks the exact dynamic pacing example requested by the user.
- The spec protects the anti-annoyance rule by rejecting pressure-heavy wording.
- The spec keeps this implementation slice independent from room, replay, and notification work.
