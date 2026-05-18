# Friend Room MVP PRD

Date: 2026-05-16  
Status: Draft for pre-implementation planning  
Product direction: Friend-based Daily Pixel Log

## Problem

Pixel World is pivoting away from a public r/place-like canvas because public global canvases compete directly with established products and can feel chaotic, anonymous, and effort-heavy.

The Friend Room MVP should test a more personal loop: a user creates a small room, invites friends, and each friend leaves one lightweight pixel trace. The first experience must feel fast, warm, and optional — never like drawing homework, a chore, or a time-pressure game.

## Target Users

1. **Room creator**
   - Wants to make a simple shared space for friends.
   - Needs room creation and sharing to complete quickly.

2. **Invited friend**
   - Arrives from a link with little context.
   - Should understand what to do immediately.
   - Should be able to leave one trace in seconds.

3. **Room owner/moderator**
   - Needs minimal control over the room if something inappropriate happens.

## Product Principle: Anti-Annoyance

The MVP succeeds only if first participation feels like:

> “I left one light trace for a friend.”

It must not feel like:

- drawing pixel art,
- managing a task,
- checking in on a schedule,
- learning game rules,
- defending territory,
- responding to nagging notifications.

### Hard Constraints

- First invited participation should be possible in under 10 seconds after opening the link.
- The first meaningful action after invite landing should require no more than one lightweight decision; nickname/profile must not be required first.
- Quick Pixel must be the primary first action.
- Manual canvas editing must be secondary, not the default first experience.
- No team war, attack, defense, item, premium, mission, or export prompt in the first participation flow.
- No language implying obligation, streak pressure, or punishment for not participating.
- Notifications, if any, must be opt-in or explicitly user-triggered later; they are not part of this MVP.
- Pixel availability should be saved as an allowance so users do not feel forced to return exactly when a timer ends.
- Saved pixel allowance must have a maximum storage window; unlimited accumulation is not allowed.
- Allowance rate must be dynamic per project: map size, target completion time, and participant count decide how many pixels each participant can place over time.
- A pixel project must not be planned to last longer than one day; the default target is a short same-day session such as 6 hours.

## Canonical Phase-1 Slice

Phase 1 validates only this loop:

```text
room creation -> invite link -> invite open -> anonymous/guest Quick Pixel -> optional name -> room-scoped realtime update -> basic funnel analytics
```

Replay, notification, streak, team, item, export, and advanced retention systems are future phases. They may be planned, but they must not appear in the first implementation flow before the friend Quick Pixel loop is proven.

## User Stories

### Room Creation

- As a user, I can create a friend room so I can invite friends to leave pixels together.
- As a room creator, I can copy an invite link immediately after creation.
- As a room creator, I can understand that the room is for lightweight friend participation, not complex drawing.

### Invite Entry

- As an invited friend, I can open a link and understand the room purpose immediately.
- As an invited friend, I can leave one pixel trace as an anonymous guest without creating an account or nickname first.
- As an invited friend, I can optionally add a nickname after the first pixel succeeds.
- As an invited friend, I can leave one pixel trace without choosing coordinates manually.

### Pixel Participation

- As a participant, I can see how many pixel actions are currently saved for me.
- As a participant, I can come back later and still use saved pixel actions within the maximum storage window.
- As a participant, my available pixel rate adapts to the project size, target finish time, and number of expected/active participants.
- As a participant, I can use Quick Pixel to place a pixel with a recommended color/location.
- As a participant, I can optionally adjust color or manually place a pixel after the first action.
- As a participant, I can see that my pixel was added successfully.
- As a participant, I can see friends’ recent activity in the room.

### Room Safety

- As a room owner, I can close or reset inappropriate room content at a basic level.
- As an admin, I can scope moderation actions to a room/canvas instead of only the global canvas.

## MVP Scope

### Included

- Friend room creation.
- Invite link generation/copy.
- Anonymous/guest first pixel without login or required nickname.
- Optional room-local nickname after first pixel success.
- Room-scoped canvas.
- Room-scoped real-time pixel updates.
- Quick Pixel as the primary first participation action.
- Dynamic project pacing: allowance rate derived from map size, target completion time, and participant count.
- Saved pixel allowance with a maximum storage window.
- Optional manual placement after Quick Pixel.
- Room participant/recent activity display.
- Minimal room owner/admin controls:
  - close room,
  - reset area or canvas,
  - remove/block abusive participant by existing actor/IP-derived signal where available.
- Basic analytics events for the room funnel.

### Existing Assets to Reuse

- Real-time pixel canvas.
- Socket-based pixel sync.
- Pixel event storage.
- Admin login/tools.
- Personal recent events, adapted or scoped for room use.

## Non-Goals

- Public global canvas redesign.
- Full Daily Pixel Log lifecycle.
- Automatic daily rollover.
- Replay/video export in the first implementation slice.
- GIF/MP4 rendering.
- Pixel stack mechanics.
- Missions, streaks, badges, or gamified pressure.
- Team war, attacks, defense, or item systems.
- Premium rooms or monetization.
- Full account system or friend graph.
- Complex template/image import flows.
- Push notification system.

## Acceptance Criteria

### Room Creation

- Given a new visitor, when they create a room with a room name, then a room is created and an invite link is shown.
- Room creation plus link copy is possible within 30 seconds for a first-time user.
- The room defaults to a simple friend log mode, not a competitive or advanced mode.

### Invite Entry

- Given an invite link, when a new visitor opens it, then they see the room name, friend context, and one primary Quick Pixel action.
- The user can complete the first pixel as an anonymous guest; no account, nickname, profile, or notification permission is required.
- After first pixel success, the user may optionally add a room-local nickname.

### Quick Pixel

- Quick Pixel is visually primary in the first participation flow.
- Quick Pixel places a valid pixel without requiring manual coordinate choice.
- The success state confirms the trace was left.
- The first participation flow avoids advanced tools before completion.
- Returning users can see saved pixel count without a pressure-heavy countdown.
- Saved pixel count is capped by maximum storage time rather than accumulating forever.
- Project pacing can be recalculated when participant count changes, but already saved pixels must not be removed as punishment.

### Real-Time Room Canvas

- Pixel updates are scoped to the current room.
- Participants in the same room see accepted pixel updates in real time.
- Participants in other rooms do not receive unrelated room updates.
- A room with 10 connected participants remains usable and synchronized.

### Anti-Annoyance

- First-time invited users are not shown missions, streaks, team mechanics, ads, premium prompts, or export prompts before their first pixel.
- Copy must emphasize light participation, e.g. “Leave one pixel for your friend,” not “complete today’s task.”
- The flow must not require choosing from a large palette or navigating the full canvas before first completion.
- Availability copy should say “saved pixels” or “pixels ready,” not “you missed your chance.”

### Safety/Admin

- Room owner or admin can perform at least one basic remediation action for inappropriate pixels.
- Admin actions are scoped by room/canvas where applicable.
- Moderation actions are auditable through existing or extended event/admin records.

### Analytics

Track at minimum:

- `room_created`
- `invite_link_copied`
- `invite_opened`
- `quick_pixel_started`
- `quick_pixel_placed`
- `optional_display_name_set`
- `manual_pixel_placed`
- `room_owner_action`

## Metrics

### MVP Success Metrics

- Room creation completion rate: target 70%+.
- Invite open to first pixel conversion: target 60%+.
- Median time from invite open to first pixel: target under 10 seconds.
- Median time from Quick Pixel tap to success feedback: target under 3 seconds.
- Returning users can understand saved pixel allowance and maximum storage in one short line.
- Project owners can see whether the selected map size and participant count can finish within the target duration.
- Average participants per room: target 3+.
- Share/copy invite rate after room creation: target 70%+.

### Anti-Annoyance Watch Metrics

- Drop-off before Quick Pixel tap.
- Drop-off after Quick Pixel tap before success.
- Drop-off before optional nickname after success.
- Manual placement usage before Quick Pixel.
- Repeat invite participation.
- User reports or feedback mentioning “confusing,” “too much,” “annoying,” “work,” or “pressure.”
- User reports or feedback mentioning saved allowance as stressful, expiring, or game-like.

### Operational Metrics

- Room reset/area reset count.
- Participant block count.
- Abuse reports per room.
- Admin response/remediation time.

## Risks

1. **First flow feels like work**
   - Mitigation: Quick Pixel first, one primary action, no advanced UI before first completion.

2. **Room creation is too much setup**
   - Mitigation: require only room name for MVP; defer mode, size, template, and advanced settings.

3. **Friends do not understand why to participate**
   - Mitigation: use emotionally clear copy: “Leave one pixel for your friend.”

4. **Manual canvas tools overwhelm invited users**
   - Mitigation: hide manual placement behind a secondary option after Quick Pixel.

5. **Abuse still happens in private rooms**
   - Mitigation: basic room owner/admin reset and block controls from MVP start.

8. **Scope creep from full Daily Pixel Log roadmap**
   - Mitigation: exclude replay, daily rollover, pixel stacks, missions, teams, export, and monetization until Friend Room participation is validated.

## Self-Review

- Problem and pivot rationale are stated.
- Target users are defined.
- Core user stories cover creator, invited friend, participant, and moderator needs.
- MVP scope is limited to Friend Room validation.
- Non-goals explicitly prevent roadmap creep.
- Anti-annoyance constraints are concrete and testable.
- Saved pixel allowance is included as a pressure-reduction mechanic with a maximum storage cap.
- Dynamic project pacing is included so large maps with few participants can be sized honestly before launch.
- Acceptance criteria are pass/fail oriented.
- Metrics include product, funnel, anti-annoyance, and operational signals.
- Risks include mitigations tied to the product principle.

## File Path

`docs/product/preimplementation/01-friend-room-mvp-prd.md`
