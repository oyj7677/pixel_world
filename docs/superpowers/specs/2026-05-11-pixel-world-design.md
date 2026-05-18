# Pixel World MVP Design

Date: 2026-05-11
Status: Approved design for implementation planning
Project root: `/Users/oyj/Desktop/workspace/pixel_world`

## 1. Product intent

Pixel World is a shared pixel canvas where many visitors collaboratively shape a web surface. The product should not force a single play style: users may cooperate to draw images, compete for territory, overwrite each other, or simply observe the evolving canvas.

The MVP focuses on a single public canvas that is easy to enter, fun to watch, and safe enough to operate. It intentionally avoids account systems and heavy game mechanics while preserving clear extension paths for login, larger canvases, seasons, teams, and ranking systems.

## 2. MVP scope

### Included

- One global canvas.
- Canvas size: `100 × 100` pixels.
- Login-free participation.
- One pixel placement every `10` seconds per anonymous actor.
- Existing pixels can always be overwritten.
- Real-time updates across connected clients.
- Color selection through:
  - fixed palette,
  - HEX color input.
- Eyedropper/color measurement:
  - clicking or selecting a pixel shows its HEX value,
  - RGB is shown alongside HEX for convenience.
- Participation indicators:
  - current online user count,
  - recent pixel changes.
- Persistent canvas state after server restart.
- Admin tools for MVP operation:
  - admin password login,
  - pixel event log viewing,
  - pixel or rectangular-area restore,
  - temporary block by anonymous browser actor/IP-derived signal.

### Excluded from MVP

- User registration and login.
- Teams/factions.
- Multi-canvas creation UI.
- Season reset UI.
- Color share statistics, rankings, activity heatmaps.
- Full abuse-prevention or moderation platform.
- Mobile-native app.

## 3. Visual direction

The visual style is **soft retro pixel game**:

- Retains pixel-art identity, grid visuals, and game-like immediacy.
- Avoids overly harsh neon contrast.
- Uses a dark or muted base with softer accent colors.
- Prioritizes the canvas and pixel tools over heavy decoration.

The main screen should feel playful, but not visually exhausting.

## 4. Recommended technical approach

Use a modular MVP architecture that can later scale horizontally.

### Confirmed stack

- Frontend/Admin: Next.js + React + TypeScript.
- Realtime/API server: Node.js + TypeScript.
- Realtime protocol: Socket.IO.
- Database: PostgreSQL.
- Cache, cooldown, and future Pub/Sub: Redis.
- Deployment: Docker-based local and production deployment path.

### Rationale

This structure is more scalable than a quick single-process prototype, but much simpler than an enterprise-scale architecture from day one. It keeps the realtime server separate from the web UI, which avoids deployment constraints around long-lived WebSocket connections on serverless platforms.

Official documentation checked during design:

- Next.js deployment documentation: https://nextjs.org/docs/app/getting-started/deploying
- Vercel WebSocket limitation note: https://vercel.com/docs/limits#websockets
- Socket.IO multi-node guidance: https://socket.io/docs/v4/using-multiple-nodes/
- Socket.IO Redis adapter: https://socket.io/docs/v4/redis-adapter/

## 5. System architecture

### Modules

#### Web app

Responsibilities:

- Render public canvas.
- Render palette, HEX input, selected color state, eyedropper state.
- Show cooldown timer.
- Show online count and recent changes.
- Render admin login and admin tools.
- Communicate with the API server through HTTP and Socket.IO.

The web app does not make final decisions about pixel validity. Client-side validation is only for immediate feedback.

#### Realtime/API server

Responsibilities:

- Accept Socket.IO connections.
- Send initial canvas snapshot to new clients.
- Validate pixel placement requests.
- Enforce cooldowns and temporary blocks.
- Persist accepted pixel changes.
- Append pixel event logs.
- Broadcast accepted updates to all connected clients.
- Serve admin APIs after admin session validation.

The server is the source of truth for all pixel mutations.

#### PostgreSQL

Responsibilities:

- Store canvas definitions.
- Store current pixel state.
- Store pixel event history.
- Store admin actions.
- Store temporary block records if persistence is required.

#### Redis

Responsibilities:

- Track anonymous actor cooldowns.
- Cache block state for fast access.
- Support Socket.IO Redis adapter when the realtime server runs on multiple nodes.

## 6. Data model draft

Implementation planning may add fields, indexes, or migration details, but the following entities and responsibilities are required.

### `canvases`

Purpose: represent a canvas instance.

Initial MVP has one record, such as `global` or `main`.

Fields:

- `id`
- `slug`
- `width`
- `height`
- `createdAt`
- `updatedAt`

### `pixels`

Purpose: current state of each colored pixel.

Fields:

- `canvasId`
- `x`
- `y`
- `colorHex`
- `updatedAt`
- `lastActorKey`

Constraint:

- Unique key on `(canvasId, x, y)`.

### `pixel_events`

Purpose: append-only history for recent activity, admin review, and restore.

Fields:

- `id`
- `canvasId`
- `x`
- `y`
- `previousColorHex`
- `newColorHex`
- `actorKey`
- `actorIpHash`
- `source`: `user` or `admin`
- `createdAt`

### `admin_actions`

Purpose: audit admin operations.

Fields:

- `id`
- `actionType`
- `targetSummary`
- `metadata`
- `createdAt`

### `blocks`

Purpose: record temporary moderation blocks.

Fields:

- `id`
- `actorKey`
- `actorIpHash`
- `reason`
- `expiresAt`
- `createdAt`

## 7. Anonymous actor model

Because MVP has no login, the server issues an anonymous browser actor key through a cookie.

The actor key is used for:

- cooldown tracking,
- recent event attribution at an anonymous level,
- temporary blocking.

IP-derived information may be used as a secondary signal, but raw IP addresses should not be exposed in the UI. Prefer hashing or partial masking for admin logs.

This model is not a strong identity system. It is intentionally a lightweight MVP mechanism that can later be replaced or supplemented by authenticated `userId`.

## 8. Pixel placement policy

Policy values should be centralized and changeable.

Initial values:

- `canvasWidth`: `100`
- `canvasHeight`: `100`
- `cooldownMs`: `10000`
- `overwritePolicy`: `always`

The overwrite policy should be implemented as a replaceable rule, not scattered through handlers. Future policies may include:

- empty-only placement,
- timed protection after placement,
- team-based ownership rules,
- admin-protected areas.

## 9. Realtime event design

### Server to client

#### `canvasSnapshot`

Sent after connection. Contains current canvas dimensions and pixel state.

#### `pixelUpdated`

Broadcast after the server accepts and persists a pixel change.

Payload:

- `canvasId`
- `x`
- `y`
- `colorHex`
- `updatedAt`

#### `cooldownUpdated`

Sent to the requesting client after pixel placement attempt or cooldown check.

Payload:

- `nextAvailableAt`
- `remainingMs`

#### `presenceUpdated`

Broadcast when online count changes.

Payload:

- `onlineCount`

#### `recentEventsUpdated`

Broadcast when recent event list changes.

Payload:

- recent pixel events with coordinates, color, and timestamp.

### Client to server

#### `placePixel`

Payload:

- `canvasId`
- `x`
- `y`
- `colorHex`

Server validation:

- canvas exists,
- `x` and `y` are within bounds,
- `colorHex` is valid,
- actor is not blocked,
- cooldown has expired,
- overwrite policy allows the mutation.

## 10. User experience flow

1. User opens the site.
2. Web app connects to Socket.IO server.
3. Server sends current canvas snapshot.
4. User selects a color from palette or enters HEX.
5. User may use eyedropper to inspect a pixel color.
6. User clicks a target pixel.
7. Client sends `placePixel`.
8. Server validates request.
9. If accepted:
   - current pixel state is updated,
   - event log is appended,
   - cooldown is updated,
   - `pixelUpdated` is broadcast.
10. If rejected:
   - user receives clear feedback, such as cooldown remaining, invalid color, blocked state, or invalid coordinates.

## 11. Admin experience flow

1. Admin opens `/admin`.
2. Admin enters password.
3. Server compares it against `ADMIN_PASSWORD` from environment variables.
4. On success, server issues a short-lived admin session cookie.
5. Admin can:
   - inspect recent pixel events,
   - restore a pixel,
   - restore a rectangular area,
   - temporarily block an actor/IP-derived signal.
6. Admin actions are logged.
7. Restore operations broadcast pixel updates so all connected clients stay synchronized.

URL-token admin access is rejected because tokens can leak through browser history, logs, and accidental sharing. Hidden APIs without a proper admin session are also rejected because they are too weak for an operational MVP.

## 12. Error handling

User-facing error states:

- Cooldown not finished: show remaining time.
- Invalid HEX color: show color input error.
- Invalid coordinate: reject request and keep local canvas unchanged.
- Blocked actor: show block message and remaining duration where appropriate.
- Socket disconnected: show reconnecting state and disable placement until connection recovers.
- Server error: show non-destructive retry guidance.

Server behavior:

- Never trust client-side cooldown state.
- Only broadcast after persistence succeeds.
- Log rejected admin-sensitive operations without exposing secrets.
- Avoid returning raw internal errors to clients.

## 13. Testing strategy

### Unit tests

Cover:

- HEX color validation.
- Coordinate validation.
- Cooldown calculation.
- Overwrite policy evaluation.
- Anonymous actor key handling.
- Admin password/session validation.

### Integration tests

Cover:

- Pixel placement writes current pixel state.
- Pixel placement appends event log.
- Cooldown prevents immediate second placement.
- Blocked actor cannot place pixels.
- Admin restore updates pixels and logs admin action.
- Socket event is emitted only after accepted mutation.

### Browser/E2E tests

Cover:

- User can load the global canvas.
- User can select palette color and place a pixel.
- User can input HEX color and place a pixel.
- Eyedropper shows the selected pixel color.
- Two browser sessions observe real-time updates.
- Admin can log in and perform a restore action.

### Local full-stack verification

The implementation should provide a Docker Compose workflow that starts:

- web app,
- realtime/API server,
- PostgreSQL,
- Redis.

MVP is not complete unless the local full stack can boot and the core real-time pixel flow can be verified.

## 14. MVP completion criteria

The MVP is complete when all of the following are true:

- A visitor can open the site without login and see the global `100 × 100` canvas.
- A visitor can select a color from the fixed palette.
- A visitor can enter a valid HEX color.
- A visitor can place one pixel after cooldown is available.
- A visitor cannot place another pixel before the `10` second cooldown expires.
- Existing pixels can be overwritten.
- Pixel changes appear in other connected browser sessions in real time.
- Eyedropper shows the selected pixel's HEX and RGB values.
- Online user count is visible.
- Recent pixel changes are visible.
- Canvas state survives server restart.
- Admin can log in with `ADMIN_PASSWORD`.
- Admin can view logs, restore pixels/areas, and temporarily block an actor/IP-derived signal.
- Canvas size, cooldown duration, and overwrite policy are configurable from centralized policy/config code.
- Core tests and local full-stack verification pass.

## 15. Future extension path

Likely post-MVP additions:

- Account login and authenticated user identity.
- Larger canvases such as `300 × 300` or `1000 × 1000`.
- Multiple canvases or season-based canvases.
- Team/faction mechanics.
- Color distribution statistics.
- Rankings and territory metrics.
- Activity heatmaps.
- Shareable snapshots.
- More advanced moderation tools.
- Horizontal scaling of realtime servers using Redis adapter.

The MVP should avoid building these features now, but should not block them architecturally.
