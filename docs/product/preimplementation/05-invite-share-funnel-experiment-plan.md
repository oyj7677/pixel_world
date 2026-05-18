# Invite/Share Funnel Experiment and Measurement Plan

Date: 2026-05-16
Status: Phase-gated pre-implementation experiment plan
Product direction: Friend-based Daily Pixel Log
Core risk: Pixel participation may feel annoying unless first participation and friend invite loops are very low-friction.

## 1. Experiment goal

Validate that a creator can make a friend room, share an invite, and an invited friend can leave one anonymous Quick Pixel with minimal effort before Pixel World invests in replay, advanced social, streak, personalization, or notification features.

Primary learning questions:

1. Can a friend invite make the first pixel action feel meaningful instead of random?
2. Can users complete first participation without account, setup, or creative-pressure friction?
3. Does a low-pressure invite create a second friend participation loop without feeling spammy?
4. Later, can optional friend-activity alerts help return behavior without making the product feel nagging?

## 2. Target funnel

The first experiment should measure the smallest Phase-1 loop:

```text
creator creates room -> creator copies invite -> friend opens invite -> friend understands context -> friend leaves anonymous Quick Pixel -> optional name -> room-scoped realtime update
```

Replay sharing, next-day return, and notifications are Phase 2+ learning loops, not Phase 1 implementation requirements.

### Funnel stages

| Stage | User intent | Required product behavior | Risk being tested |
| --- | --- | --- | --- |
| Room creation | Creator starts a friend room | Room name only, invite generated | Setup feels like work |
| Invite share | Creator copies/sends invite | Clear friend-specific value, not generic virality | Sharing feels spammy |
| Invite open | Friend lands from link | Show who invited them and why it matters | Friend has no context |
| First pixel | Friend contributes | No account/nickname wall before first action | Onboarding blocks action |
| Optional name | Friend decides whether to identify | Name after success, stay anonymous allowed | Identity feels mandatory |
| Room update | Room reflects the pixel | Scoped realtime update only in that room | Privacy/sync confusion |

## 3. Instrumented funnel events

Use stable, behavior-focused analytics event names. Event names should describe user-observable actions, not implementation internals.

### Invite creation and share events

| Event name | When fired | Required properties |
| --- | --- | --- |
| `room_created` | Creator creates a friend room | `room_public_id`, `source`, `room_privacy` |
| `invite_link_created` | Default room invite is generated | `room_public_id`, `invite_variant` |
| `invite_link_copied` | Creator copies invite link | `room_public_id`, `invite_variant`, `surface` |
| `invite_share_intent_clicked` | Creator taps a native share/copy channel | `room_public_id`, `invite_variant`, `share_channel` |
| `invite_share_completed` | Native share reports completion or link copy succeeds | `room_public_id`, `invite_variant`, `share_channel` |
| `invite_prompt_dismissed` | Creator closes or ignores share prompt | `room_public_id`, `prompt_variant`, `dismiss_reason` |

### Invite recipient events

| Event name | When fired | Required properties |
| --- | --- | --- |
| `invite_landing_viewed` | Recipient opens invite landing screen | `invite_variant`, `referrer_type`, `landing_variant` |
| `invite_context_expanded` | Recipient taps to learn more before acting | `landing_variant` |
| `project_pacing_viewed` | Creator or participant sees project feasibility/pacing | `room_public_id`, `required_pixel_count`, `target_completion_ms`, `effective_participant_count`, `dynamic_interval_ms` |
| `saved_pixel_allowance_viewed` | User sees saved pixel count | `room_public_id`, `saved_count`, `max_saved_count`, `dynamic_interval_ms`, `surface` |
| `recipient_quick_pixel_started` | Recipient taps or starts Quick Pixel | `room_public_id`, `landing_variant`, `onboarding_variant`, `saved_count_before` |
| `recipient_first_pixel_completed` | Recipient saves first pixel | `room_public_id`, `landing_variant`, `onboarding_variant`, `completion_ms`, `color_family`, `saved_count_before` |
| `recipient_first_pixel_abandoned` | Recipient exits or times out after starting | `room_public_id`, `landing_variant`, `onboarding_variant`, `abandon_step` |
| `optional_display_name_viewed` | Name prompt is shown after success | `room_public_id`, `surface` |
| `optional_display_name_set` | Recipient adds a room-local name after success | `room_public_id`, `surface` |
| `optional_display_name_skipped` | Recipient stays anonymous | `room_public_id`, `surface` |

### Phase 2+ notification and retention events

| Event name | When fired | Required properties |
| --- | --- | --- |
| `notification_permission_prompt_viewed` | App asks whether to enable reminders | `prompt_variant`, `trigger_event` |
| `notification_permission_granted` | User grants reminder permission | `prompt_variant`, `trigger_event` |
| `notification_permission_denied` | User denies reminder permission | `prompt_variant`, `trigger_event` |
| `daily_pixel_reminder_scheduled` | Reminder is scheduled | `cadence`, `quiet_hours_enabled` |
| `daily_pixel_reminder_sent` | Reminder is sent | `cadence`, `notification_type` |
| `daily_pixel_reminder_opened` | User opens from reminder | `cadence`, `notification_type` |
| `daily_pixel_reminder_muted` | User disables reminders or pauses them | `cadence`, `mute_duration` |
| `friend_activity_viewed` | User views friend daily activity | `entry_date`, `source` |
| `daily_returned` | User returns on a later day | `days_since_first_pixel`, `source` |

## 4. Success metrics

### Primary success metrics

These decide whether the invite/share loop is promising enough to build deeper features.

| Metric | Definition | Target for pre-implementation confidence |
| --- | --- | --- |
| Invite recipient activation | `recipient_first_pixel_completed / invite_landing_viewed` | At least 35% for warm friend invites |
| First-pixel time | Median time from `invite_landing_viewed` to `recipient_first_pixel_completed` | Under 10 seconds |
| Dynamic pacing comprehension | Creators understand whether map size + participants can finish within target duration | Majority of moderated testers understand before starting |
| Saved allowance comprehension | Users can explain saved pixel count/max storage after seeing one line | Majority of moderated testers understand without describing pressure |
| Invite share completion | `invite_share_completed / invite_prompt_viewed` | At least 20% without dark patterns |
| Reply/share-back rate | `recipient_invite_back_completed / recipient_first_pixel_completed` | At least 15% |
| Day-1 friend return | Users who return next day after first friend interaction | At least 25% |

### Guardrail metrics

These prevent optimizing for spam or short-term clicks.

| Metric | Definition | Stop or revise if |
| --- | --- | --- |
| Invite prompt dismissal | `invite_prompt_dismissed / invite_prompt_viewed` | Over 60% for a variant |
| First-pixel abandonment | `recipient_first_pixel_abandoned / recipient_first_pixel_started` | Over 35% |
| Notification mute rate | `daily_pixel_reminder_muted / notification_permission_granted` | Over 20% in first 7 days |
| Same-day notification annoyance | Users muting within 1 hour of a reminder | Over 8% |
| Repeat invite fatigue | Share completion drops after first invite prompt exposure | More than 50% relative decline |
| Pacing impossibility | Required per-user rate is too fast for normal use | Recommend smaller map/more people/faster placement UX before launch |
| Saved allowance anxiety | Users describe saved count as expiring pressure, lost value, or streak-like obligation | Recurring qualitative mentions in moderated tests |

### Diagnostic metrics

Use these to understand why a metric moves.

- Landing-to-start rate: `recipient_first_pixel_started / invite_landing_viewed`.
- Start-to-complete rate: `recipient_first_pixel_completed / recipient_first_pixel_started`.
- Copy-link vs native-share completion by `share_channel`.
- Completion time by onboarding variant.
- Return source mix for Phase 2+: direct, invite, reminder, friend activity, copied link.
- Friend-pair activity: days where both members place or react, measured without storing message contents.
- Project pacing feasibility by `required_pixel_count`, `effective_participant_count`, and `target_completion_ms`.
- Saved allowance usage: completion and abandonment by `saved_count_before`.

## 5. A/B copy tests

Each copy test should change one promise at a time. Do not test visual layout, onboarding steps, and copy in the same variant unless the test is explicitly exploratory.

### Invite prompt copy

Goal: Determine whether friend-specific meaning beats generic sharing.

| Variant | Copy direction | Hypothesis | Primary metric |
| --- | --- | --- | --- |
| A: Friend moment | "Share today's pixel with a friend" | Plain friend context is low-pressure | `invite_share_completed / invite_prompt_viewed` |
| B: Reply loop | "Ask a friend to add their pixel back" | Reciprocity drives participation | `recipient_invite_back_completed / recipient_first_pixel_completed` |
| C: Daily ritual | "Start a tiny daily log together" | Shared ritual improves later return | Day-1 friend return |

Recommendation: Start with A vs B. Add C only after the first-pixel funnel is healthy, because ritual framing may overpromise before the loop is proven.

### Invite landing copy

Goal: Help recipients understand the action before they bounce.

| Variant | Landing headline | Risk tested |
| --- | --- | --- |
| A: Personal | "[Friend] shared today's pixel with you" | Personal context reduces confusion |
| B: Action-first | "Pick one pixel for today" | Action clarity reduces hesitation |
| C: Together | "Build a tiny daily log together" | Shared ritual increases return |

Measure landing-to-start, start-to-complete, first-pixel time, and invite-back completion.

### Reminder copy

Goal: Learn whether reminders feel supportive or pushy.

| Variant | Copy direction | Limit |
| --- | --- | --- |
| A: Gentle personal | "Your friend added today's pixel" | Max one per friend activity day |
| B: Daily completion | "Add today's pixel when you have a second" | Max one per day |
| C: Streak-free | "No streak pressure — just today's pixel" | Max one per day, no streak language |

Avoid urgency, guilt, streak-loss warnings, or social pressure copy during validation.

## 6. Onboarding friction tests

The first experiments should aggressively test how little onboarding is needed.

| Variant | Steps before first pixel | What it tests | Expected trade-off |
| --- | --- | --- | --- |
| A: Zero-account first pixel | Invite open -> choose pixel -> save | Maximum low-friction activation | Lower identity quality |
| B: Name after first pixel | Invite open -> choose pixel -> save -> optional display name | Whether personalization can wait | Slightly better social context |
| C: One-screen explanation | Invite open -> short explanation -> choose pixel -> save | Whether context improves confidence | Higher friction risk |

Recommended starting test: A vs B. Do not test account creation before first pixel in the initial validation phase. If identity is required later, introduce it only after first contribution, not before.

Friction rules for all variants:

- No mandatory account creation before first pixel.
- No mandatory notification permission before first pixel.
- No required contact upload.
- No required profile photo.
- No creative blank-page prompt; offer a small palette and a default suggested pixel option.
- Show progress in one sentence or less.

## 7. Notification limits

Notification experiments are Phase 3 only. They must validate helpful optional friend-activity alerts without training users to ignore or mute the product.

### Initial notification policy

- Ask for notification permission only after a user completes at least one pixel action or receives visible friend activity.
- Default to no more than one reminder per user per day.
- Default to no more than three reminders per user per rolling seven days until retention is validated.
- Never send more than one notification for the same friend activity cluster.
- Respect quiet hours, with a default quiet window of 21:00-09:00 local time when available.
- Provide a visible mute/pause option from notification settings and relevant in-product surfaces.
- Do not use streak-loss or guilt-based copy.

### Notification test cells

| Cell | Trigger | Cadence | Success metric | Guardrail |
| --- | --- | --- | --- | --- |
| A: No reminder control | No reminder | None | Baseline Day-1/Day-7 return | Lower activation acceptable as control |
| B: Friend activity | Friend adds or replies | Max 1/day, max 3/week | Reminder open -> daily pixel completion | Mute rate |
| C: User-chosen daily reminder | User opts in after first pixel | User-selected time, max 1/day | Day-7 return | Mute and permission denial |

Recommendation: Use A/B/C only after first-pixel activation is validated. Before then, notifications can mask onboarding problems.

## 8. Retention metrics

Retention should be measured around friend-pair behavior, not only individual visits.

### Individual retention

- Day-1 return: user completes or views a daily pixel one calendar day after first pixel.
- Day-3 return: user returns within three calendar days after first pixel.
- Day-7 return: user returns within seven calendar days after first pixel.
- Weekly active pixel days: number of days with `daily_pixel_entry_completed` in a seven-day window.
- Reminder-assisted return: return source is reminder and user completes a pixel within 10 minutes.

### Friend-loop retention

- Pair Day-1 return: both inviter and recipient return the next day.
- Pair reciprocal activity: recipient completes first pixel and inviter views or responds within 24 hours.
- Pair active days: number of days in a seven-day window where at least two linked friends participate.
- Invite chain depth: count of successful first-pixel recipients downstream from a seed user, capped and aggregated for privacy.
- Healthy loop rate: invite recipient activation multiplied by reply/share-back completion multiplied by Day-1 friend return.

### Interpretation guidance

- Strong first-pixel activation with weak Day-1 return means the invite is understandable but the ritual is not yet valuable.
- Weak first-pixel activation with strong returns among completers means onboarding is the first bottleneck.
- High share intent with low completed share means channel mechanics or copy trust is broken.
- High reminder open with high mute means reminders are driving action at the cost of product trust.

## 9. Privacy-friendly logging

The experiment must produce useful funnel learning without storing unnecessary personal data.

### Data minimization

- Do not log raw message contents, contact lists, address books, or friend names typed into share sheets.
- Do not store raw IP addresses in analytics. If abuse or deduplication needs an IP-derived signal, store a rotated salted hash separate from event analytics.
- Do not log exact pixel note text in analytics. Use `has_note: true/false` and optional coarse length bucket if needed.
- Do not log full invite URLs with tokens. Log an `invite_id` or hashed invite token.
- Do not log precise device identifiers. Use first-party anonymous actor IDs with rotation support.
- Coarsen timestamps for long-term retention analysis when exact event order is no longer needed.

### Suggested common event properties

| Property | Allowed values or format | Privacy note |
| --- | --- | --- |
| `anonymous_actor_id` | First-party pseudonymous ID | Rotatable; not shared externally |
| `experiment_id` | Stable experiment key | No PII |
| `variant_id` | Stable variant key | No PII |
| `entry_date` | Calendar date | Avoid exact location inference |
| `source` | `direct`, `invite`, `reminder`, `friend_activity`, `copy_link`, `native_share` | Coarse attribution only |
| `share_channel` | `native_share`, `copy_link`, `sms`, `messaging_app`, `unknown` | Use coarse categories when exact app detection is unavailable |
| `color_family` | Coarse bucket such as `red`, `blue`, `green`, `neutral`, `custom` | Do not need exact creative choice for funnel analysis |
| `completion_ms` | Duration bucket or integer capped at 10 minutes | Cap to reduce outliers and fingerprinting |
| `friend_pair_id` | Hash of pair relationship | Use scoped hash; do not expose raw user IDs |

### Retention and deletion

- Keep raw event-level analytics only as long as needed for experiment analysis.
- Prefer aggregated experiment reports for long-term product decisions.
- Support deletion or rotation of actor identifiers before scaling the system.
- Separate operational abuse logs from product analytics, with stricter access and shorter retention.

## 10. Experiment sequencing

### Phase 0: Instrumented prototype validation

Goal: Learn whether the funnel is worth implementing fully.

- Build the smallest testable flow: create room, generate/copy invite, open invite, complete anonymous Quick Pixel, optional name.
- Use fake or lightweight identity if needed, but keep event names production-compatible.
- Run moderated sessions with 5-8 friend pairs before broad testing.
- Watch for confusion, hesitation, and annoyance language.

Exit criteria:

- Participants can explain why they were invited.
- Median invite-open to first-pixel completion is under 10 seconds in moderated testing. Any session over 60 seconds triggers failure diagnosis, not success.
- No recurring feedback that the share prompt feels spammy or obligatory.

### Phase 1: Invite copy and first-pixel friction

Goal: Validate invite landing and onboarding before notifications.

- Test invite prompt A vs B.
- Test onboarding A vs B.
- Hold notification prompts out of the flow.
- Measure activation, time-to-first-pixel, share-back, and abandonment.

Exit criteria:

- Recipient activation meets or approaches 35%.
- First-pixel abandonment is below 35%.
- Invite copy/share completion is high enough to create measurable invite traffic without making the share prompt feel obligatory.

### Phase 2: Retention without pressure

Goal: Determine whether friend activity creates natural return behavior.

- Add friend activity view and direct return tracking.
- Keep reminders off or use a no-reminder control.
- Measure Day-1, Day-3, and pair reciprocal activity.

Exit criteria:

- Day-1 friend return reaches at least 25%, or qualitative feedback identifies a clear fix.
- Pair reciprocal activity suggests users care about seeing or responding to friends' pixels.

### Phase 3: Notification limits

Goal: Test whether reminders help without harming trust.

- Add notification cells only after Phase 1 and Phase 2 meet minimum learning thresholds.
- Compare no reminder, friend activity reminder, and user-chosen daily reminder.
- Monitor mute, denial, and same-day annoyance rates closely.

Exit criteria:

- Reminder-assisted completion improves return without crossing mute guardrails.
- Users describe reminders as useful or optional, not nagging.

## 11. Pre-implementation validation checklist

Do not build advanced Pixel World features until this checklist is complete.

### Measurement readiness

- [ ] Event taxonomy is reviewed and stable enough for prototype implementation.
- [ ] Each event has a single owner, trigger definition, and required property list.
- [ ] Experiment assignment rules prevent users from switching variants mid-funnel.
- [ ] Analytics can connect inviter, invite, recipient, and friend-pair outcomes without storing raw personal data.
- [ ] Dashboards or queries exist for primary metrics, guardrails, and retention cohorts.

### Product readiness

- [ ] First-pixel flow works without mandatory account creation.
- [ ] Invite landing page clearly shows friend context and the next action.
- [ ] Share prompt can be dismissed without penalty or repeated nagging.
- [ ] Notification permission prompt is not shown before first contribution.
- [ ] Project pacing formula is reviewed for the selected map size, participant count, and target duration.
- [ ] Saved pixel allowance is explained without urgency, streak, or loss language.
- [ ] Mute or pause controls are visible before notification experiments scale.

### Experiment readiness

- [ ] A/B variants differ by one main hypothesis at a time.
- [ ] Sample size expectations are documented before launch.
- [ ] Stop conditions are defined for annoyance, abandonment, and privacy concerns.
- [ ] Qualitative observation plan exists for early friend-pair sessions.
- [ ] No advanced features are allowed to compensate for a broken first-pixel funnel.

### Privacy readiness

- [ ] Raw IP addresses, contacts, message contents, and full invite URLs are excluded from analytics.
- [ ] Actor IDs and friend-pair IDs are pseudonymous and rotatable.
- [ ] Analytics retention windows are documented.
- [ ] Access to experiment data is limited to people who need it for product decisions.
- [ ] User-facing privacy language is drafted before any real-user test.

## 12. Decision framework

After the first complete experiment cycle, choose one of three paths:

1. **Proceed to deeper friend-loop implementation** if activation, share completion, and Day-1 friend return meet targets without guardrail failures.
2. **Iterate onboarding and copy only** if users like the concept after completing first pixel but too many recipients abandon before that point.
3. **Pause advanced feature work** if participation is described as annoying, obligatory, spammy, or unclear even after low-friction copy and onboarding tests.

The product should earn the right to add streaks, richer profiles, canvases, reactions, or notification sophistication only after the first friend-based pixel loop proves useful without pressure.

## 13. Self-review

- The funnel covers inviter creation, invite sharing, recipient landing, first pixel, share-back, and friend return rather than only the initial click.
- The primary success metrics are balanced by explicit annoyance, privacy, and notification guardrails.
- Notification prompts remain blocked until users have already received friend-context value.
- The plan avoids logging raw contacts, message contents, full invite URLs, or other unnecessarily sensitive data.
- Advanced engagement systems are intentionally gated behind proof that the first friend-pixel loop is useful and low-friction.

## 14. File path changed

- `docs/product/preimplementation/05-invite-share-funnel-experiment-plan.md`
