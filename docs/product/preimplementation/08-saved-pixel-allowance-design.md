# 08. Dynamic Saved Pixel Allowance Design

Date: 2026-05-16  
Status: Pre-implementation design addendum  
Scope: Phase 1 pressure-reduction and project pacing mechanic

## 1. Intent

A pure cooldown can make users feel they should return exactly when the timer ends. That creates pressure and can make pixel placement feel like work.

But a fixed “one pixel every N seconds” rule is also wrong for project-based maps. A 100×100 map with 4 participants has a different completion requirement than a 32×32 map with 20 participants.

The project should feel like:

> “우리가 정한 시간 안에 자연스럽게 끝낼 수 있게 픽셀 횟수가 맞춰진다.”

not:

> “고정 쿨타임이 끝날 때마다 무조건 들어와야 한다.”

## 2. Product rule

- Pixel projects should finish in a short same-day cycle.
- A project target must not exceed one day.
- Default planning target is 6 hours for a group session such as work/school time.
- Pixel opportunities are saved over time so users can step away briefly.
- Saved opportunities are capped by maximum storage time.
- The accrual rate is dynamic per project, based on map size, target completion time, and participant count.

## 3. Dynamic pacing formula

Definitions:

```text
requiredPixelCount = width * height - fixedOrPreFilledPixels
targetCompletionMs = desired same-day completion window
effectiveParticipantCount = expected or active participants used for pacing
dynamicAllowanceIntervalMs = targetCompletionMs * effectiveParticipantCount / requiredPixelCount
maxSavedCount = floor(pixelAllowanceMaxStorageMs / dynamicAllowanceIntervalMs)
```

The server should calculate this as a project pacing snapshot. It may recalculate future accrual when participant count changes, but it must not remove already saved actions as punishment.

## 4. Example: 100×100, 4 people, 6 hours

```text
requiredPixelCount = 100 * 100 = 10,000
targetCompletionMs = 6 hours = 21,600 seconds
effectiveParticipantCount = 4

pixels per participant = 10,000 / 4 = 2,500
dynamic interval = 21,600 * 4 / 10,000 = 8.64 seconds
```

Each participant needs enough allowance to place about 2,500 pixels over 6 hours.

If max storage is 30 minutes:

```text
maxStorage = 1,800 seconds
maxSavedCount = floor(1,800 / 8.64) = 208
```

So a participant can step away for a break and return with saved pixel actions, but cannot accumulate infinite power for days.

## 5. UX implication

For large maps, the math can require many pixels per person. If every pixel requires a careful single click, the project will feel like labor.

Therefore, when the calculated interval is short or saved count becomes large, implementation planning should consider:

- drag-to-place while spending saved count,
- rapid tap placement,
- batch Quick Pixel,
- fill recommended empty cells,
- progress preview that shows the group can finish on time.

The pacing system should not solve an impossible project by nagging users. It should help the creator pick a realistic map size, participant count, and target window.

## 6. Max storage rule

Maximum storage should be project-relative, not a full day by default.

Recommended defaults:

- `targetCompletionMs`: 6 hours.
- hard max project duration: under 24 hours.
- `pixelAllowanceMaxStorageMs`: 30 minutes or around 10% of target duration.
- never let saved actions accumulate across project days.

## 7. UX copy

Preferred:

- “208 pixels saved for this project.”
- “This project is paced to finish in about 6 hours.”
- “Saved for a while, so there’s no rush.”
- “4 people can finish this 100×100 map in about 6 hours.”

Avoid:

- “Use before it expires.”
- “You wasted a pixel.”
- “Come back now.”
- “Keep your streak.”
- “Your team will fall behind because of you.”

## 8. Data/API expectations

Quick Pixel or project session responses should expose:

- `targetCompletionMs`
- `requiredPixelCount`
- `effectiveParticipantCount`
- `dynamicAllowanceIntervalMs`
- `savedPixelCount`
- `maxSavedPixelCount`
- `nextPixelSavedAt`
- `maxStorageEndsAt`
- `projectedCompletionAt` when useful

The backend can compute allowance lazily on read/write. It does not need to tick in real time.

## 9. Abuse and complexity guardrails

- No unlimited accumulation.
- No project duration over one day.
- No cross-room global pool in Phase 1.
- No monetized refill mechanic in Phase 1.
- No urgency-driven expiry UI.
- No streak mechanic tied to saved allowance.
- No removal of already saved actions when participant count changes.

## 10. Acceptance criteria

- A creator can see whether map size + participant count + target duration is feasible before project start.
- 100×100, 4 participants, 6-hour target computes about 8.64 seconds per saved action.
- A returning user can see saved pixel count in one calm line.
- A user who returns after a short break can still place saved pixels up to the cap.
- A user who reaches the cap does not see guilt or loss language.
- Saved allowance is scoped to room+actor and does not leak across rooms.
- First invited Quick Pixel is not blocked by allowance calculation.

## 11. Self-review

- The mechanic supports the user’s anti-annoyance goal.
- The rate is dynamic by map size, target duration, and participant count.
- The 100×100 / 4 people / 6 hours example is explicitly calculated.
- Maximum storage time prevents infinite accumulation.
- Copy avoids urgency, blame, and streak pressure.
- The feature remains Phase 1-compatible without adding accounts, notifications, or monetization.
