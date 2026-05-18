# Quick Pixel UX Design Spec

Date: 2026-05-16
Status: Pre-implementation product/UX spec
Project: Pixel World pivot to friend-based Daily Pixel Log
Primary principle: **Users must never feel this is annoying or work.**

## 1. Product intent

Quick Pixel turns Pixel World from an open realtime canvas into a tiny daily social gesture: leave one pixel for a friend, then move on.

The product should feel closer to tapping a shoulder, signing a postcard, or leaving a small sticker than completing a task. The first successful action must be possible in about three seconds with no account explanation, no canvas strategy, no color anxiety, and no visible productivity framing.

## 2. Core experience promise

> “Leave one pixel for a friend today.”

The experience is built around one low-decision action:

1. A friend is already selected.
2. A color is already suggested.
3. A safe pixel spot is already highlighted.
4. The user taps once.
5. The app confirms warmly and gets out of the way.

Everything else is secondary and should stay hidden until after the first pixel is placed.

## 3. UX principles

### 3.1 Make the first action smaller than a thought

- No setup before the first pixel.
- No profile creation before the first pixel.
- No “choose a mode” screen.
- No explanation of global canvases, admin tools, realtime infrastructure, or future mechanics.
- No prompts that imply obligation: avoid “complete,” “must,” “task,” “goal,” “deadline,” and “keep your streak.”

### 3.2 Friendship before canvas mechanics

The user is not joining a canvas. They are leaving something for a person.

Preferred framing:

- “Mina saved a tiny spot for you.”
- “Leave one pixel for Jay.”
- “Your blue dot landed on Nari’s day.”

Avoid framing:

- “Place a pixel on the board.”
- “Contribute to the daily grid.”
- “Maintain your activity streak.”

### 3.3 Optionality protects warmth

The user should always feel allowed to skip, leave quietly, or return later.

Required tone:

- Gentle, casual, low-pressure.
- No guilt if inactive.
- No punishment language.
- No visible score pressure on the first screen.

### 3.4 Delight comes after action, not before it

The first screen should be almost bare. Celebration, friend context, history, reactions, and discovery can appear only after the pixel is left.

## 4. Primary user states

### 4.1 First-run user from a friend invite

Likely intent: “What did my friend send me?”

System defaults:

- Friend: invite sender.
- Pixel color: friendly default derived from sender/day palette.
- Pixel position: pre-highlighted open spot in the friend’s daily log.
- Identity: anonymous until after the pixel is placed.
- Notification permission: not requested.
- Friend suggestions: not shown before action.

Primary CTA:

- “Leave this pixel”

Secondary action:

- “Not now”

Success target:

- User can land, understand the gesture, tap once, and see success in about three seconds.

### 4.2 First-run user without a specific friend

Likely intent: “What is this?”

System defaults:

- Show a sample friend card, not a blank app shell.
- Offer one soft onboarding action: “Try leaving a pixel.”
- Use demo copy that makes clear this is a tiny daily friend gesture.
- Ask for name only after the demo action, if needed.

Primary CTA:

- “Try one pixel”

Secondary action:

- “I have an invite”

### 4.3 Returning user with friend activity

Likely intent: “Anything small to do today?”

System defaults:

- Open directly to the most relevant friend for today.
- Prioritize friends who left the user a pixel, then close friends who have an empty spot, then recent friends.
- Preserve last-used color only if it reduces thought; otherwise suggest today’s color.
- Show one pending friend at a time.

Primary CTA:

- “Leave today’s pixel”

Secondary actions after first action:

- “Leave another”
- “See my day”
- “Send invite”

### 4.4 Returning user with no obvious action

Likely intent: “Did anything happen?”

System defaults:

- Show the user’s own daily log first.
- Highlight any pixels friends left.
- Offer one gentle next step, not a checklist.

Primary CTA options:

- “Invite a friend” when no friends exist.
- “Leave a free pixel” when friends exist but no one needs attention.
- “Come back later” as a valid low-pressure exit.

## 5. First-run flow

### 5.1 Entry from friend invite

1. User opens invite link.
2. App loads a compact friend card:
   - Friend avatar/name.
   - Today label.
   - Small daily pixel log preview.
   - One highlighted pixel.
   - One selected color.
3. User taps “Leave this pixel.”
4. Pixel lands immediately with soft feedback.
5. App shows a success state.
6. Only after success, app may offer optional identity and continuation choices.

### 5.2 First-run flow detail

```text
[Friend invite landing]

Mina saved a tiny spot for you

[  small daily pixel log preview  ]
[  one open cell softly glowing   ]

Today's color: sky blue ●

[Leave this pixel]

Not now
```

On tap:

```text
[Success]

You left a pixel for Mina

[ daily log preview with new pixel ]

Want Mina to know it was you?
[Add my name]
[Stay quiet]

Secondary, lower emphasis:
See Mina's day

Invite/share is hidden unless the user asks for it or returns after seeing value.
```

### 5.3 Identity after action

Identity collection must never block the first pixel.

Allowed after success:

- Display name.
- Lightweight avatar color.
- “Remember me on this device.”

Not allowed before success:

- Account creation.
- Password setup.
- Phone/email verification.
- Notification permission.
- Contact import.

Recommended copy:

- “Want Mina to know it was you?”
- “Add a name for next time.”
- “Stay quiet”

Avoid copy:

- “Create your account.”
- “Complete your profile.”
- “Sign up to continue.”

## 6. Returning-user flow

### 6.1 Daily entry

1. User opens app.
2. App selects one friend/action for today.
3. User sees a single-card prompt.
4. User taps once to leave a pixel.
5. App confirms and then reveals optional next actions.

```text
[Daily prompt]

Jay has a quiet spot today

[ daily log preview ]
[ highlighted suggested cell ]

Warm yellow ● is ready

[Leave today’s pixel]

Maybe later
```

### 6.2 After returning-user success

```text
[Success]

Your yellow pixel landed on Jay’s day

[updated daily log preview]

Tiny nice thing done.

[Leave another]
[See my day]

Lower emphasis:
Share invite · Change color next time
```

### 6.3 Returning user who already left for selected friend

Do not make the user feel blocked or scolded.

```text
[Already left]

You already left Jay a pixel today

[updated daily log preview]

Nice. That’s enough.

[See my day]
[Leave one for someone else]
```

### 6.4 Returning user with friend pixels received

```text
[Received pixels]

Three friends left pixels on your day

[ my daily log preview ]

[Open my day]
[Leave one back]
```

## 7. Microcopy system

### 7.1 Voice

- Short.
- Human.
- Specific to a friend when possible.
- Warm without being childish.
- Never productivity-coded.

### 7.2 Primary CTAs

Use:

- “Leave this pixel”
- “Leave today’s pixel”
- “Send one back”
- “Try one pixel”
- “Invite a friend”

Avoid:

- “Submit”
- “Save”
- “Complete”
- “Start task”
- “Continue workflow”
- “Place on canvas”

### 7.3 Secondary actions

Use:

- “Not now”
- “Maybe later”
- “Stay quiet”
- “See my day”
- “Leave another”
- “Change color”

Avoid:

- “Skip challenge”
- “Dismiss”
- “No thanks, I don’t care”
- “Cancel task”

### 7.4 Success messages

Use:

- “You left a pixel for Mina.”
- “Your blue pixel landed.”
- “Tiny nice thing done.”
- “Mina will see it today.”
- “That’s enough for now.”

Avoid:

- “Daily task complete.”
- “Streak maintained.”
- “Contribution submitted.”
- “Engagement recorded.”

### 7.5 Loading messages

Use:

- “Finding today’s tiny spot…”
- “Warming up your pixel…”
- “Opening Mina’s day…”

Avoid:

- “Loading dashboard…”
- “Fetching canvas data…”
- “Initializing session…”

## 8. Empty states

### 8.1 No friends yet

Goal: invite without making the app feel empty or failed.

```text
[No friends]

Pixels are better with one friend

Invite someone and you’ll both get a tiny daily spot.

[Invite a friend]

Lower emphasis:
Try a sample day
```

### 8.2 Friend has no pixels today

Goal: make the user feel like first contact is welcome, not lonely.

```text
[Friend quiet day]

You can be the first tiny color on Mina’s day

[empty daily log preview with one highlighted cell]

[Leave this pixel]
```

### 8.3 User has received no pixels today

Goal: avoid sadness or pressure.

```text
[My quiet day]

Your day is still quiet

No rush. You can invite a friend or just check back later.

[Invite a friend]
[Leave a pixel for someone]
```

### 8.4 No activity after success

Goal: permit completion.

```text
[Done state]

That’s all for now

You left today a little brighter.

[See my day]
```

### 8.5 Invite link opened by someone already connected

```text
[Known friend invite]

You and Mina are already pixel friends

Want to leave today’s pixel?

[Leave today’s pixel]
[See Mina’s day]
```

## 9. Error and edge states

### 9.1 Offline before placing

```text
[Offline]

You’re offline right now

We’ll keep this pixel ready while you reconnect.

[Try again]
```

Behavior:

- Preserve selected friend, color, and highlighted spot locally.
- Do not ask the user to reselect anything.

### 9.2 Offline after tap

```text
[Pending]

Holding your pixel for Mina

It’ll land when you’re back online.

[Okay]
```

Behavior:

- If reliable queued placement is not implemented, use “Try again” instead of implying guaranteed delivery.
- Never duplicate the pixel if the user taps again after reconnect.

### 9.3 Friend day unavailable

```text
[Unavailable]

Mina’s day is taking a second to open

[Try again]
[Leave one later]
```

Avoid exposing server, socket, or database language.

### 9.4 Invite expired or invalid

```text
[Expired invite]

This tiny spot is no longer open

You can ask for a fresh invite or start your own day.

[Start my day]
```

### 9.5 Pixel spot taken during realtime update

```text
[Spot changed]

That spot just filled in

We picked a new tiny spot for you.

[Leave this pixel]
```

Behavior:

- Automatically choose another open spot.
- Keep the same color.
- Do not force the user into manual placement.

### 9.6 Rate limit or repeat action

Do not show “rate limit” to users.

```text
[Soft pause]

Your pixel already landed today

That’s enough. You can leave one for someone else if you want.

[Leave one for someone else]
[See my day]
```

### 9.7 Abuse/moderation block

This should be rare and plain.

```text
[Limited]

Pixel leaving is paused on this device for now

Try again later.
```

Do not show admin details, enforcement signals, or technical reasons.

## 10. Low-friction defaults

### 10.1 Friend default

Priority order:

1. Friend from invite link.
2. Friend who left the user a pixel today.
3. Most recently exchanged friend.
4. Friend with an empty daily spot.
5. Sample friend/demo state.

The first screen must show exactly one primary friend target.

### 10.2 Color default

Initial rule:

- Auto-select a friendly daily color.
- Show the color as a small named swatch.
- Let users change it only after they notice the option.

Suggested color labels:

- Sky blue
- Warm yellow
- Soft green
- Peach
- Lilac
- Berry
- Cloud white
- Ink

The color picker should not be the first decision. It may appear as a small “Change color” text action after the primary CTA or after first success.

### 10.3 Pixel position default

Initial rule:

- Preselect a visually safe open cell.
- Highlight it softly.
- Do not require zooming, panning, or precision tapping.

If the app allows manual placement later, it should be a post-success advanced interaction, not the default first action.

### 10.4 Saved pixel allowance default

Initial rule:

- Replace pure cooldown pressure with project-paced saved pixel allowance.
- A user earns pixel actions at a rate calculated from project map size, target completion time, and participant count.
- Unused actions are saved only up to a maximum storage window.
- The product should frame this as “you still have pixels ready,” not “you are late.”
- The first invited Quick Pixel should start with at least one available action.

Recommended default for planning:

- Target project duration: same-day, default 6 hours, hard max under 24 hours.
- Allowance interval: computed as `targetDurationMs * participantCount / requiredPixelCount`.
- Maximum storage window: a short project-relative window, default 30 minutes or about 10% of target duration, never the whole project by default.
- Maximum saved count: derived from `floor(maxStorageMs / dynamicAllowanceIntervalMs)`, minimum 1.

Preferred copy:

- “2 pixels saved.”
- “One more pixel will be saved later.”
- “Saves for a while, so there’s no rush.”
- “This project is paced to finish in about 6 hours.”

Avoid copy:

- “Use it before it expires!”
- “You’re wasting pixels.”
- “Come back now.”
- Red urgency timers unless the user explicitly opens details.

### 10.5 Notification default

Initial rule:

- No notification permission prompt on first run.
- No daily reminder prompt before the user has completed at least one successful session and shown intent to return.
- Later notifications must be framed as optional friend-activity alerts, not habit enforcement.

Preferred later copy:

- “Want a gentle nudge when a friend leaves you a pixel?”

Avoid:

- “Enable notifications to stay engaged.”
- “Don’t miss your streak.”

### 10.6 Sharing default

Initial rule:

- Share/invite must never be the primary action immediately after first pixel.
- It may appear only as a low-emphasis option after visible value, or when the user explicitly asks to share.
- Dismissing share should be durable for the current session/day.
- Invite copy should frame a small social gesture, not app acquisition.

Preferred invite copy:

- “I saved a tiny spot for you.”
- “Leave one pixel on my day?”

## 11. Screen hierarchy

### 11.1 First screen hierarchy

Required order:

1. Friend-specific headline.
2. Daily pixel log preview.
3. Suggested color and highlighted spot.
4. Primary CTA.
5. Low-pressure exit.

Not on first screen:

- Navigation tabs.
- Activity feed.
- Leaderboards.
- Canvas controls.
- Admin entry points.
- Full color palette.
- Streak counters.
- Settings.
- Global explore mode.

### 11.2 Post-success hierarchy

Allowed after first pixel:

1. Confirmation.
2. Updated visual result.
3. Optional identity.
4. Optional next friend.
5. Optional user’s own day.
6. Optional invite/share.

## 12. Text wireframes

### 12.1 Invite first-run

```text
┌─────────────────────────────────┐
│ Mina saved a tiny spot for you  │
│                                 │
│        ┌──────────────┐         │
│        │ ▫ ▫ ▫ ▫ ▫ ▫ │         │
│        │ ▫ ▫ ◌ ▫ ▫ ▫ │         │
│        │ ▫ ▫ ▫ ▫ ▫ ▫ │         │
│        └──────────────┘         │
│                                 │
│ Sky blue is ready ●             │
│                                 │
│ [ Leave this pixel ]            │
│                                 │
│ Not now                         │
└─────────────────────────────────┘
```

### 12.2 First-run success

```text
┌─────────────────────────────────┐
│ You left a pixel for Mina       │
│                                 │
│        ┌──────────────┐         │
│        │ ▫ ▫ ▫ ▫ ▫ ▫ │         │
│        │ ▫ ▫ ● ▫ ▫ ▫ │         │
│        │ ▫ ▫ ▫ ▫ ▫ ▫ │         │
│        └──────────────┘         │
│                                 │
│ Want Mina to know it was you?   │
│                                 │
│ [ Add my name ]                 │
│ [ Stay quiet ]                  │
│                                 │
│ See Mina’s day                  │
└─────────────────────────────────┘
```

### 12.3 Returning daily prompt

```text
┌─────────────────────────────────┐
│ Jay has a quiet spot today      │
│                                 │
│        ┌──────────────┐         │
│        │ ▫ ● ▫ ▫ ▫ ▫ │         │
│        │ ▫ ▫ ▫ ◌ ▫ ▫ │         │
│        │ ▫ ▫ ● ▫ ▫ ▫ │         │
│        └──────────────┘         │
│                                 │
│ 2 pixels saved · no rush        │
│ Warm yellow is ready ●          │
│                                 │
│ [ Leave today’s pixel ]         │
│                                 │
│ Maybe later                     │
└─────────────────────────────────┘
```

### 12.4 Returning success with next actions

```text
┌─────────────────────────────────┐
│ Your yellow pixel landed        │
│                                 │
│ Tiny nice thing done.           │
│                                 │
│        ┌──────────────┐         │
│        │ ▫ ● ▫ ▫ ▫ ▫ │         │
│        │ ▫ ▫ ▫ ● ▫ ▫ │         │
│        │ ▫ ▫ ● ▫ ▫ ▫ │         │
│        └──────────────┘         │
│                                 │
│ [ Leave another ]               │
│ [ See my day ]                  │
│                                 │
│ Share invite (lower emphasis)  │
│ Hide for today                  │
└─────────────────────────────────┘
```

### 12.5 No friends

```text
┌─────────────────────────────────┐
│ Pixels are better with one friend│
│                                 │
│ Invite someone and you’ll both  │
│ get a tiny daily spot.          │
│                                 │
│ [ Invite a friend ]             │
│                                 │
│ Try a sample day                │
└─────────────────────────────────┘
```

### 12.6 My day with received pixels

```text
┌─────────────────────────────────┐
│ Three friends left pixels today │
│                                 │
│        ┌──────────────┐         │
│        │ ▫ ● ▫ ● ▫ ▫ │         │
│        │ ▫ ▫ ▫ ▫ ▫ ▫ │         │
│        │ ▫ ▫ ● ▫ ▫ ▫ │         │
│        └──────────────┘         │
│                                 │
│ [ Send one back ]               │
│ [ Invite a friend ]             │
└─────────────────────────────────┘
```

## 13. Interaction notes

### 13.1 Tap feedback

- Pixel should appear immediately on tap in the selected spot.
- Use a small pop, glow, or ripple.
- Keep animation under one second.
- Avoid confetti on every placement; it can become noisy.

### 13.2 Haptics and sound

If available later:

- Use one soft haptic tick on successful placement.
- Sound should default off or be extremely subtle.
- Never use repeating reminder sounds.

### 13.3 Motion tone

Motion should feel like a small object landing, not a game reward explosion.

Preferred:

- Soft scale-in of pixel.
- Gentle halo fade.
- Friend card settling into done state.

Avoid:

- Slot-machine effects.
- XP bars.
- Streak fire.
- Full-screen celebration before the user understands the product.

## 14. Do not expose yet: advanced modes

These capabilities may exist in the current app or future architecture, but they must not appear on the initial Quick Pixel screen.

### 14.1 Global realtime canvas

Do not expose yet:

- Public world canvas.
- Realtime multiplayer presence.
- Recent global pixel stream.
- Canvas-wide overwrite strategy.
- Zoom/pan tools as primary UI.

Reason:

- The global canvas creates decisions and strategy. Quick Pixel starts as a person-to-person gesture.

Possible later entry:

- A post-success link: “See the wider world” after the friend action is complete.

### 14.2 Advanced color tools

Do not expose yet:

- Full HEX input.
- Eyedropper.
- RGB readouts.
- Custom palettes.
- Color statistics.

Reason:

- Color tools are useful for creation, but the first action should not require taste or precision.

Possible later entry:

- “Change color” after first placement or in settings.

### 14.3 Manual drawing or multi-pixel creation

Do not expose yet:

- Brush tools.
- Multi-pixel placement.
- Drawing mode.
- Templates.
- Pixel art editor.

Reason:

- Drawing turns the gesture into work. The first experience is one pixel only.

Possible later entry:

- Friend-specific “make a tiny pattern” mode for users who repeatedly engage.

### 14.4 Streaks, leaderboards, and rankings

Do not expose yet:

- Streak counters on first screen.
- Friend rankings.
- Contribution counts.
- Competitive scoreboards.
- “You missed yesterday” messaging.

Reason:

- These mechanics risk making the product feel obligatory.

Possible later entry:

- Private, gentle memory surfaces such as “You and Mina have 12 shared pixels,” without pressure.

### 14.5 Admin and moderation tools

Do not expose yet:

- Admin login.
- Event logs.
- Restore tools.
- Block controls.
- Operational dashboards.

Reason:

- They are necessary for operation but irrelevant and potentially trust-reducing for ordinary users.

Required handling:

- Keep admin routes separate, unlinked from the consumer first-run flow, and visually distinct.

### 14.6 Notification and contact growth loops

Do not expose yet:

- Notification permission prompt.
- Contact import.
- “Find friends” address book flow.
- Growth banners.
- Reminder scheduling.

Reason:

- Asking for permissions before value is felt makes the app feel extractive.

Possible later entry:

- After the user receives a pixel or returns voluntarily.

## 15. Acceptance criteria for implementation planning

A future implementation plan should preserve these UX constraints:

- First invited user can leave one pixel without account creation.
- First screen has one primary CTA and one low-pressure exit.
- Friend, color, and pixel position have defaults.
- User identity is requested only after a successful first pixel.
- Notification permission is not requested on first run.
- Advanced canvas, color, admin, ranking, and growth modes are not visible on the first screen.
- Error states preserve the user’s previous selection whenever possible.
- Copy avoids productivity, streak, and obligation language.
- Returning users see one suggested daily action, not a dashboard of chores.

## 16. Open implementation questions for later planning

These are intentionally deferred and should not block this UX spec:

- Exact size of each friend’s daily pixel log.
- Whether queued offline placement is supported or replaced with retry-only behavior.
- How friend identity is created and stored before full accounts exist.
- How invite links map to a specific friend/day/spot.
- Whether “stay quiet” means anonymous to the friend or simply unnamed in public UI.
- When, if ever, global canvas mode re-enters the consumer navigation.

## 17. Self-review

- Placeholder scan: No placeholder markers remain.
- Internal consistency: The spec keeps first action to one friend, one suggested color, one suggested pixel, and one primary CTA across first-run and returning flows.
- Scope check: This is documentation-only pre-implementation planning for Quick Pixel UX; dynamic project-paced saved allowance is expressed as UX behavior while backend details are defined in data/contract docs.
- Ambiguity check: Advanced modes are explicitly marked “do not expose yet” so the first screen remains focused on the three-second friend gesture.
- Principle check: Copy and flows avoid obligation, productivity framing, streak pressure, and setup before value.

## 18. File path changed

- `docs/product/preimplementation/02-quick-pixel-ux-spec.md`
