# Pixel World MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Pixel World MVP: one anonymous, persistent, realtime `100 × 100` pixel canvas with soft-retro UI, cooldown-limited pixel placement, eyedropper color measurement, online/recent activity, and password-protected admin tools.

**Architecture:** Use an npm-workspaces monorepo with three focused units: `packages/shared` for policy/contracts, `apps/server` for Fastify + Socket.IO + PostgreSQL + Redis, and `apps/web` for Next.js UI/admin. The server is the mutation source of truth; clients render snapshots and accepted realtime updates only.

**Tech Stack:** TypeScript, npm workspaces, Next.js, React, Fastify, Socket.IO, PostgreSQL, Redis, Vitest, Playwright, Docker Compose.

---

## Scope check

The approved spec spans web UI, realtime API, persistence, Redis-backed policy state, and admin tools. These are separate modules but not independent products: the MVP is only useful when the end-to-end pixel flow works. Keep one implementation plan, with tasks ordered so each task produces a verifiable slice.

## Locked assumptions from the design

- Initial canvas id: `global`.
- Initial canvas size: `100 × 100`.
- Default unpainted pixel color: `#FFFFFF`.
- Initial cooldown: `10_000` ms.
- Initial overwrite policy: `always`.
- Anonymous actor identity: signed/HTTP-only cookie named `pw_actor` plus hashed IP signal for admin review.
- Admin auth: `/admin` password form backed by `ADMIN_PASSWORD`, issuing HTTP-only cookie `pw_admin`.
- Raw IP addresses are not shown in UI and are not stored in event records; store `actorIpHash`.

## File structure

Create this structure:

```text
.
├── apps
│   ├── server
│   │   ├── migrations/001_init.sql
│   │   ├── package.json
│   │   ├── src
│   │   │   ├── admin/adminRoutes.ts
│   │   │   ├── app.ts
│   │   │   ├── auth/adminSession.ts
│   │   │   ├── auth/actorIdentity.ts
│   │   │   ├── config.ts
│   │   │   ├── db/canvasRepository.ts
│   │   │   ├── db/index.ts
│   │   │   ├── db/migrate.ts
│   │   │   ├── index.ts
│   │   │   ├── realtime/socketServer.ts
│   │   │   └── services/cooldownService.ts
│   │   ├── test
│   │   │   ├── adminRoutes.test.ts
│   │   │   ├── actorIdentity.test.ts
│   │   │   ├── cooldownService.test.ts
│   │   │   └── pixelFlow.test.ts
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   ├── web
│   │   ├── next.config.ts
│   │   ├── package.json
│   │   ├── src
│   │   │   ├── app/admin/page.tsx
│   │   │   ├── app/globals.css
│   │   │   ├── app/layout.tsx
│   │   │   ├── app/page.tsx
│   │   │   ├── components/AdminPanel.tsx
│   │   │   ├── components/CanvasBoard.tsx
│   │   │   ├── components/ColorTools.tsx
│   │   │   ├── components/RecentEvents.tsx
│   │   │   ├── components/StatusBar.tsx
│   │   │   └── lib/socketClient.ts
│   │   ├── test/canvasBoard.test.tsx
│   │   └── tsconfig.json
│   └── e2e
│       ├── package.json
│       ├── playwright.config.ts
│       └── tests/pixel-world.spec.ts
├── docker-compose.yml
├── docs/superpowers/specs/2026-05-11-pixel-world-design.md
├── package.json
├── packages/shared
│   ├── package.json
│   ├── src/colors.ts
│   ├── src/index.ts
│   ├── src/pixelPolicy.ts
│   ├── src/socketEvents.ts
│   ├── test/colors.test.ts
│   ├── test/pixelPolicy.test.ts
│   ├── tsconfig.json
│   └── vitest.config.ts
├── tsconfig.base.json
└── .env.example
```

Responsibilities:

- `packages/shared`: pure validation, policy constants, socket payload types; no DB, browser, or server dependencies.
- `apps/server`: all mutation validation, persistence, cooldown, admin auth, and realtime broadcast.
- `apps/web`: rendering, user interaction, and admin UI only; never trusts itself as source of truth.
- `apps/e2e`: black-box browser verification across web and server.

---

### Task 1: Workspace scaffold and dependency baseline

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/vitest.config.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/e2e/package.json`
- Create: `apps/e2e/playwright.config.ts`

- [ ] **Step 1: Create directories**

Run:

```bash
mkdir -p packages/shared/src packages/shared/test
mkdir -p apps/server/src apps/server/test apps/server/migrations
mkdir -p apps/web/src/app/admin apps/web/src/components apps/web/src/lib apps/web/test
mkdir -p apps/e2e/tests
```

Expected: directories exist with no command output.

- [ ] **Step 2: Write root workspace files**

Write `package.json`:

```json
{
  "name": "pixel-world",
  "private": true,
  "workspaces": [
    "packages/shared",
    "apps/server",
    "apps/web",
    "apps/e2e"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "dev:server": "npm run dev --workspace @pixel-world/server",
    "dev:web": "npm run dev --workspace @pixel-world/web",
    "migrate": "npm run migrate --workspace @pixel-world/server",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "e2e": "npm run test --workspace @pixel-world/e2e"
  },
  "devDependencies": {
    "@types/node": "latest",
    "typescript": "latest"
  }
}
```

Write `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

Write `.env.example`:

```dotenv
NODE_ENV=development
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
PORT=4000
DATABASE_URL=postgres://pixel:pixel@localhost:5432/pixel_world
REDIS_URL=redis://localhost:6379
COOKIE_SECRET=replace-with-a-long-random-development-secret
ADMIN_PASSWORD=replace-with-a-local-admin-password
IP_HASH_SECRET=replace-with-a-long-random-ip-hash-secret
```

Write `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: pixel
      POSTGRES_PASSWORD: pixel
      POSTGRES_DB: pixel_world
    ports:
      - "5432:5432"
    volumes:
      - pixel_world_pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pixel -d pixel_world"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  pixel_world_pg:
```

- [ ] **Step 3: Write package manifests**

Write `packages/shared/package.json`:

```json
{
  "name": "@pixel-world/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "vitest": "latest"
  }
}
```

Write `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["vitest/globals"]
  },
  "include": ["src", "test"]
}
```

Write `packages/shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true
  }
});
```

Write `apps/server/package.json`:

```json
{
  "name": "@pixel-world/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "dev": "tsx watch src/index.ts",
    "migrate": "tsx src/db/migrate.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@fastify/cookie": "latest",
    "@fastify/cors": "latest",
    "@pixel-world/shared": "0.0.0",
    "fastify": "latest",
    "ioredis": "latest",
    "pg": "latest",
    "socket.io": "latest"
  },
  "devDependencies": {
    "@types/pg": "latest",
    "tsx": "latest",
    "vitest": "latest"
  }
}
```

Write `apps/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "test"]
}
```

Write `apps/server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 15000
  }
});
```

Write `apps/web/package.json`:

```json
{
  "name": "@pixel-world/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "next build",
    "dev": "next dev",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@pixel-world/shared": "0.0.0",
    "next": "latest",
    "react": "latest",
    "react-dom": "latest",
    "socket.io-client": "latest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "jsdom": "latest",
    "vitest": "latest"
  }
}
```

Write `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "allowJs": false,
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Write `apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@pixel-world/shared']
};

export default nextConfig;
```

Write `apps/e2e/package.json`:

```json
{
  "name": "@pixel-world/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@playwright/test": "latest",
    "typescript": "latest"
  }
}
```

Write `apps/e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
```

- [ ] **Step 4: Install dependencies**

Run:

```bash
npm install
```

Expected: npm creates `package-lock.json` and installs workspace dependencies without errors.

- [ ] **Step 5: Verify workspace scripts are discoverable**

Run:

```bash
npm run typecheck --workspaces --if-present
```

Expected: typecheck fails only because source files are not created yet, or reports no input files for empty workspaces. If npm reports malformed workspace configuration, fix manifests before continuing.

- [ ] **Step 6: Commit scaffold**

Run:

```bash
git add package.json package-lock.json tsconfig.base.json .env.example docker-compose.yml packages apps
git commit -m "Prepare the Pixel World workspace for modular implementation" \
  -m "Constraint: The approved design requires separate shared, server, web, and e2e units.\nRejected: A single unstructured app | It would make realtime scaling and admin separation harder.\nConfidence: high\nScope-risk: narrow\nDirective: Keep shared code pure and keep server-side mutation authority out of the web app.\nTested: npm install and workspace script discovery.\nNot-tested: Application behavior is not implemented yet."
```

Expected: commit succeeds.

---

### Task 2: Shared contracts, color validation, and pixel policy

**Files:**
- Create: `packages/shared/src/colors.ts`
- Create: `packages/shared/src/pixelPolicy.ts`
- Create: `packages/shared/src/socketEvents.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/test/colors.test.ts`
- Create: `packages/shared/test/pixelPolicy.test.ts`

- [ ] **Step 1: Write failing tests for color utilities**

Write `packages/shared/test/colors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE, hexToRgb, normalizeHexColor } from '../src/colors';

describe('normalizeHexColor', () => {
  it('normalizes valid 6-digit colors to uppercase with leading hash', () => {
    expect(normalizeHexColor('#38bdf8')).toBe('#38BDF8');
    expect(normalizeHexColor('ef4444')).toBe('#EF4444');
  });

  it('expands valid 3-digit colors', () => {
    expect(normalizeHexColor('#0af')).toBe('#00AAFF');
  });

  it('rejects invalid colors', () => {
    expect(normalizeHexColor('blue')).toBeNull();
    expect(normalizeHexColor('#12')).toBeNull();
    expect(normalizeHexColor('#xyzxyz')).toBeNull();
  });
});

describe('hexToRgb', () => {
  it('converts normalized hex to rgb channels', () => {
    expect(hexToRgb('#38BDF8')).toEqual({ r: 56, g: 189, b: 248 });
  });
});

describe('DEFAULT_PALETTE', () => {
  it('contains normalized unique colors', () => {
    expect(DEFAULT_PALETTE.length).toBeGreaterThanOrEqual(16);
    expect(new Set(DEFAULT_PALETTE).size).toBe(DEFAULT_PALETTE.length);
    expect(DEFAULT_PALETTE.every((color) => color === normalizeHexColor(color))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run test --workspace @pixel-world/shared -- colors.test.ts
```

Expected: FAIL because `../src/colors` does not exist.

- [ ] **Step 3: Implement color utilities**

Write `packages/shared/src/colors.ts`:

```ts
export type HexColor = `#${string}`;

export const DEFAULT_CANVAS_COLOR: HexColor = '#FFFFFF';

export const DEFAULT_PALETTE: HexColor[] = [
  '#FFFFFF',
  '#E2E8F0',
  '#0F172A',
  '#EF4444',
  '#F97316',
  '#FACC15',
  '#22C55E',
  '#14B8A6',
  '#06B6D4',
  '#38BDF8',
  '#3B82F6',
  '#6366F1',
  '#8B5CF6',
  '#D946EF',
  '#F472B6',
  '#FB7185'
];

const HEX_6 = /^[0-9a-fA-F]{6}$/;
const HEX_3 = /^[0-9a-fA-F]{3}$/;

export function normalizeHexColor(input: string): HexColor | null {
  const raw = input.trim().replace(/^#/, '');

  if (HEX_6.test(raw)) {
    return `#${raw.toUpperCase()}`;
  }

  if (HEX_3.test(raw)) {
    const expanded = raw
      .split('')
      .map((char) => `${char}${char}`)
      .join('')
      .toUpperCase();
    return `#${expanded}`;
  }

  return null;
}

export function hexToRgb(color: HexColor): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    throw new Error(`Invalid HEX color: ${color}`);
  }

  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16)
  };
}
```

- [ ] **Step 4: Write failing tests for pixel policy**

Write `packages/shared/test/pixelPolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CANVAS_ID,
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_COOLDOWN_MS,
  createPixelPolicy,
  validateCoordinate
} from '../src/pixelPolicy';

describe('pixel policy constants', () => {
  it('matches the approved MVP values', () => {
    expect(DEFAULT_CANVAS_ID).toBe('global');
    expect(DEFAULT_CANVAS_WIDTH).toBe(100);
    expect(DEFAULT_CANVAS_HEIGHT).toBe(100);
    expect(DEFAULT_COOLDOWN_MS).toBe(10000);
  });
});

describe('validateCoordinate', () => {
  const policy = createPixelPolicy();

  it('accepts coordinates inside the canvas', () => {
    expect(validateCoordinate(policy, 0, 0)).toEqual({ ok: true });
    expect(validateCoordinate(policy, 99, 99)).toEqual({ ok: true });
  });

  it('rejects coordinates outside the canvas', () => {
    expect(validateCoordinate(policy, -1, 0)).toEqual({ ok: false, reason: 'x_out_of_bounds' });
    expect(validateCoordinate(policy, 0, 100)).toEqual({ ok: false, reason: 'y_out_of_bounds' });
  });
});
```

- [ ] **Step 5: Run tests and verify failure**

Run:

```bash
npm run test --workspace @pixel-world/shared -- pixelPolicy.test.ts
```

Expected: FAIL because `../src/pixelPolicy` does not exist.

- [ ] **Step 6: Implement pixel policy and socket contracts**

Write `packages/shared/src/pixelPolicy.ts`:

```ts
export const DEFAULT_CANVAS_ID = 'global';
export const DEFAULT_CANVAS_WIDTH = 100;
export const DEFAULT_CANVAS_HEIGHT = 100;
export const DEFAULT_COOLDOWN_MS = 10000;
export const OVERWRITE_POLICY_ALWAYS = 'always' as const;

export type OverwritePolicy = typeof OVERWRITE_POLICY_ALWAYS;

export interface PixelPolicy {
  canvasId: string;
  width: number;
  height: number;
  cooldownMs: number;
  overwritePolicy: OverwritePolicy;
}

export function createPixelPolicy(overrides: Partial<PixelPolicy> = {}): PixelPolicy {
  return {
    canvasId: DEFAULT_CANVAS_ID,
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    overwritePolicy: OVERWRITE_POLICY_ALWAYS,
    ...overrides
  };
}

export type CoordinateValidationResult =
  | { ok: true }
  | { ok: false; reason: 'x_out_of_bounds' | 'y_out_of_bounds' | 'not_integer' };

export function validateCoordinate(policy: PixelPolicy, x: number, y: number): CoordinateValidationResult {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return { ok: false, reason: 'not_integer' };
  }

  if (x < 0 || x >= policy.width) {
    return { ok: false, reason: 'x_out_of_bounds' };
  }

  if (y < 0 || y >= policy.height) {
    return { ok: false, reason: 'y_out_of_bounds' };
  }

  return { ok: true };
}
```

Write `packages/shared/src/socketEvents.ts`:

```ts
import type { HexColor } from './colors';

export interface PixelRecord {
  x: number;
  y: number;
  colorHex: HexColor;
  updatedAt: string;
}

export interface RecentPixelEvent {
  id: string;
  x: number;
  y: number;
  previousColorHex: HexColor | null;
  newColorHex: HexColor;
  actorKey: string;
  actorIpHash: string;
  source: 'user' | 'admin';
  createdAt: string;
}

export interface CanvasSnapshotPayload {
  canvasId: string;
  width: number;
  height: number;
  defaultColorHex: HexColor;
  pixels: PixelRecord[];
  recentEvents: RecentPixelEvent[];
  onlineCount: number;
  nextAvailableAt: string;
}

export interface PlacePixelPayload {
  canvasId: string;
  x: number;
  y: number;
  colorHex: string;
}

export interface PixelUpdatedPayload extends PixelRecord {
  canvasId: string;
}

export interface CooldownUpdatedPayload {
  nextAvailableAt: string;
  remainingMs: number;
}

export interface PresenceUpdatedPayload {
  onlineCount: number;
}

export interface RecentEventsUpdatedPayload {
  events: RecentPixelEvent[];
}

export interface PlacementRejectedPayload {
  reason:
    | 'invalid_canvas'
    | 'invalid_coordinate'
    | 'invalid_color'
    | 'cooldown_active'
    | 'blocked'
    | 'server_error';
  message: string;
  remainingMs?: number;
}
```

Write `packages/shared/src/index.ts`:

```ts
export * from './colors';
export * from './pixelPolicy';
export * from './socketEvents';
```

- [ ] **Step 7: Verify shared package**

Run:

```bash
npm run test --workspace @pixel-world/shared
npm run typecheck --workspace @pixel-world/shared
```

Expected: PASS.

- [ ] **Step 8: Commit shared contracts**

Run:

```bash
git add packages/shared
git commit -m "Define shared Pixel World policy and realtime contracts" \
  -m "Constraint: Server and web clients need one source for canvas policy, colors, and event payloads.\nRejected: Duplicating validation in each app | It would create drift around cooldowns, colors, and coordinate bounds.\nConfidence: high\nScope-risk: narrow\nDirective: Keep shared package dependency-free and side-effect-free.\nTested: npm run test --workspace @pixel-world/shared; npm run typecheck --workspace @pixel-world/shared.\nNot-tested: Server and browser integration are not implemented yet."
```

Expected: commit succeeds.

---

### Task 3: PostgreSQL schema, migration runner, and canvas repository

**Files:**
- Create: `apps/server/migrations/001_init.sql`
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/db/index.ts`
- Create: `apps/server/src/db/migrate.ts`
- Create: `apps/server/src/db/canvasRepository.ts`
- Create: `apps/server/test/pixelFlow.test.ts`

- [ ] **Step 1: Write database migration**

Write `apps/server/migrations/001_init.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pixels (
  canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  color_hex TEXT NOT NULL CHECK (color_hex ~ '^#[0-9A-F]{6}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_actor_key TEXT NOT NULL,
  PRIMARY KEY (canvas_id, x, y)
);

CREATE TABLE IF NOT EXISTS pixel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  previous_color_hex TEXT CHECK (previous_color_hex IS NULL OR previous_color_hex ~ '^#[0-9A-F]{6}$'),
  new_color_hex TEXT NOT NULL CHECK (new_color_hex ~ '^#[0-9A-F]{6}$'),
  actor_key TEXT NOT NULL,
  actor_ip_hash TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pixel_events_canvas_created_idx
  ON pixel_events(canvas_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  target_summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_key TEXT,
  actor_ip_hash TEXT,
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (actor_key IS NOT NULL OR actor_ip_hash IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS blocks_actor_key_idx ON blocks(actor_key, expires_at);
CREATE INDEX IF NOT EXISTS blocks_actor_ip_hash_idx ON blocks(actor_ip_hash, expires_at);

INSERT INTO canvases (id, slug, width, height)
VALUES ('global', 'global', 100, 100)
ON CONFLICT (id) DO UPDATE
SET width = EXCLUDED.width,
    height = EXCLUDED.height,
    updated_at = now();
```

- [ ] **Step 2: Write config and DB helpers**

Write `apps/server/src/config.ts`:

```ts
import { createPixelPolicy } from '@pixel-world/shared';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface ServerConfig {
  nodeEnv: string;
  port: number;
  webOrigin: string;
  databaseUrl: string;
  redisUrl: string;
  cookieSecret: string;
  adminPassword: string;
  ipHashSecret: string;
  policy: ReturnType<typeof createPixelPolicy>;
}

export function loadConfig(): ServerConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? '4000'),
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    cookieSecret: requireEnv('COOKIE_SECRET'),
    adminPassword: requireEnv('ADMIN_PASSWORD'),
    ipHashSecret: requireEnv('IP_HASH_SECRET'),
    policy: createPixelPolicy()
  };
}
```

Write `apps/server/src/db/index.ts`:

```ts
import pg from 'pg';
import type { ServerConfig } from '../config';

const { Pool } = pg;

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient | pg.Pool;

export function createDbPool(config: ServerConfig): DbPool {
  return new Pool({ connectionString: config.databaseUrl });
}
```

Write `apps/server/src/db/migrate.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbPool } from './index';
import { loadConfig } from '../config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const config = loadConfig();
  const pool = createDbPool(config);
  try {
    const migrationPath = join(__dirname, '../../migrations/001_init.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Write failing repository integration test**

Write `apps/server/test/pixelFlow.test.ts`:

```ts
import { DEFAULT_CANVAS_COLOR } from '@pixel-world/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { upsertPixelAndLog, getCanvasSnapshot, getRecentEvents } from '../src/db/canvasRepository';
import { createDbPool, type DbPool } from '../src/db/index';
import { runMigrations } from '../src/db/migrate';

let pool: DbPool;

beforeAll(async () => {
  await runMigrations();
  pool = createDbPool(loadConfig());
  await pool.query('DELETE FROM pixel_events');
  await pool.query('DELETE FROM pixels');
});

afterAll(async () => {
  await pool.end();
});

describe('canvas repository', () => {
  it('stores a pixel, returns it in the snapshot, and logs the event', async () => {
    const saved = await upsertPixelAndLog(pool, {
      canvasId: 'global',
      x: 3,
      y: 4,
      colorHex: '#38BDF8',
      actorKey: 'actor-a',
      actorIpHash: 'ip-hash-a',
      source: 'user'
    });

    expect(saved.previousColorHex).toBeNull();
    expect(saved.newColorHex).toBe('#38BDF8');

    const snapshot = await getCanvasSnapshot(pool, 'global');
    expect(snapshot.defaultColorHex).toBe(DEFAULT_CANVAS_COLOR);
    expect(snapshot.pixels).toContainEqual(
      expect.objectContaining({ x: 3, y: 4, colorHex: '#38BDF8' })
    );

    const events = await getRecentEvents(pool, 'global', 10);
    expect(events[0]).toEqual(expect.objectContaining({ x: 3, y: 4, newColorHex: '#38BDF8' }));
  });
});
```

- [ ] **Step 4: Start data services and verify repository test fails**

Run:

```bash
cp .env.example .env
# Edit .env with non-empty local secrets if the example values are still present.
docker compose up -d db redis
npm run test --workspace @pixel-world/server -- pixelFlow.test.ts
```

Expected: FAIL because `canvasRepository` does not exist.

- [ ] **Step 5: Implement canvas repository**

Write `apps/server/src/db/canvasRepository.ts`:

```ts
import {
  DEFAULT_CANVAS_COLOR,
  type HexColor,
  type PixelRecord,
  type RecentPixelEvent
} from '@pixel-world/shared';
import type { DbClient } from './index';

interface UpsertPixelInput {
  canvasId: string;
  x: number;
  y: number;
  colorHex: HexColor;
  actorKey: string;
  actorIpHash: string;
  source: 'user' | 'admin';
}

export interface LoggedPixelEvent extends RecentPixelEvent {}

function mapPixel(row: { x: number; y: number; color_hex: string; updated_at: Date }): PixelRecord {
  return {
    x: row.x,
    y: row.y,
    colorHex: row.color_hex as HexColor,
    updatedAt: row.updated_at.toISOString()
  };
}

function mapEvent(row: {
  id: string;
  x: number;
  y: number;
  previous_color_hex: string | null;
  new_color_hex: string;
  actor_key: string;
  actor_ip_hash: string;
  source: 'user' | 'admin';
  created_at: Date;
}): RecentPixelEvent {
  return {
    id: row.id,
    x: row.x,
    y: row.y,
    previousColorHex: row.previous_color_hex as HexColor | null,
    newColorHex: row.new_color_hex as HexColor,
    actorKey: row.actor_key,
    actorIpHash: row.actor_ip_hash,
    source: row.source,
    createdAt: row.created_at.toISOString()
  };
}

export async function getCanvasSnapshot(db: DbClient, canvasId: string) {
  const canvasResult = await db.query(
    'SELECT id, width, height FROM canvases WHERE id = $1',
    [canvasId]
  );

  const canvas = canvasResult.rows[0];
  if (!canvas) {
    throw new Error(`Canvas not found: ${canvasId}`);
  }

  const pixelsResult = await db.query(
    'SELECT x, y, color_hex, updated_at FROM pixels WHERE canvas_id = $1 ORDER BY y ASC, x ASC',
    [canvasId]
  );

  return {
    canvasId: canvas.id as string,
    width: Number(canvas.width),
    height: Number(canvas.height),
    defaultColorHex: DEFAULT_CANVAS_COLOR,
    pixels: pixelsResult.rows.map(mapPixel)
  };
}

export async function getRecentEvents(
  db: DbClient,
  canvasId: string,
  limit: number
): Promise<RecentPixelEvent[]> {
  const result = await db.query(
    `SELECT id, x, y, previous_color_hex, new_color_hex, actor_key, actor_ip_hash, source, created_at
     FROM pixel_events
     WHERE canvas_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [canvasId, limit]
  );

  return result.rows.map(mapEvent);
}

export async function upsertPixelAndLog(
  db: DbClient,
  input: UpsertPixelInput
): Promise<LoggedPixelEvent> {
  const client = 'connect' in db ? await db.connect() : db;
  const shouldRelease = 'release' in client;

  try {
    await client.query('BEGIN');

    const previousResult = await client.query(
      `SELECT color_hex
       FROM pixels
       WHERE canvas_id = $1 AND x = $2 AND y = $3
       FOR UPDATE`,
      [input.canvasId, input.x, input.y]
    );
    const previousColorHex = previousResult.rows[0]?.color_hex ?? null;

    await client.query(
      `INSERT INTO pixels (canvas_id, x, y, color_hex, last_actor_key, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (canvas_id, x, y)
       DO UPDATE SET color_hex = EXCLUDED.color_hex,
                     last_actor_key = EXCLUDED.last_actor_key,
                     updated_at = now()`,
      [input.canvasId, input.x, input.y, input.colorHex, input.actorKey]
    );

    const eventResult = await client.query(
      `INSERT INTO pixel_events
       (canvas_id, x, y, previous_color_hex, new_color_hex, actor_key, actor_ip_hash, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, x, y, previous_color_hex, new_color_hex, actor_key, actor_ip_hash, source, created_at`,
      [
        input.canvasId,
        input.x,
        input.y,
        previousColorHex,
        input.colorHex,
        input.actorKey,
        input.actorIpHash,
        input.source
      ]
    );

    await client.query('COMMIT');
    return mapEvent(eventResult.rows[0]) as LoggedPixelEvent;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}
```

- [ ] **Step 6: Verify repository**

Run:

```bash
npm run test --workspace @pixel-world/server -- pixelFlow.test.ts
npm run typecheck --workspace @pixel-world/server
```

Expected: PASS.

- [ ] **Step 7: Commit persistence layer**

Run:

```bash
git add apps/server/migrations apps/server/src/config.ts apps/server/src/db apps/server/test/pixelFlow.test.ts
git commit -m "Persist the global canvas and pixel event log" \
  -m "Constraint: MVP canvas state must survive server restarts and support admin review.\nRejected: In-memory canvas storage | It would violate the persistence requirement.\nConfidence: high\nScope-risk: moderate\nDirective: Treat PostgreSQL as the source of truth for accepted pixel mutations.\nTested: docker compose up -d db redis; npm run test --workspace @pixel-world/server -- pixelFlow.test.ts; npm run typecheck --workspace @pixel-world/server.\nNot-tested: Socket.IO broadcast and browser rendering are not implemented yet."
```

Expected: commit succeeds.

---

### Task 4: Server app shell, actor identity, cooldown, and block services

**Files:**
- Create: `apps/server/src/auth/actorIdentity.ts`
- Create: `apps/server/src/services/cooldownService.ts`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/test/actorIdentity.test.ts`
- Create: `apps/server/test/cooldownService.test.ts`

- [ ] **Step 1: Write failing actor identity tests**

Write `apps/server/test/actorIdentity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashIpAddress, isValidActorKey } from '../src/auth/actorIdentity';

describe('actor identity', () => {
  it('accepts generated actor keys and rejects unsafe values', () => {
    expect(isValidActorKey('act_0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isValidActorKey('')).toBe(false);
    expect(isValidActorKey('../bad')).toBe(false);
  });

  it('hashes IP addresses with a secret without exposing the raw IP', () => {
    const hash = hashIpAddress('203.0.113.8', 'secret-a');
    expect(hash).not.toContain('203.0.113.8');
    expect(hash).toHaveLength(64);
    expect(hashIpAddress('203.0.113.8', 'secret-a')).toBe(hash);
    expect(hashIpAddress('203.0.113.8', 'secret-b')).not.toBe(hash);
  });
});
```

- [ ] **Step 2: Run actor identity test and verify failure**

Run:

```bash
npm run test --workspace @pixel-world/server -- actorIdentity.test.ts
```

Expected: FAIL because `actorIdentity` does not exist.

- [ ] **Step 3: Implement actor identity helpers**

Write `apps/server/src/auth/actorIdentity.ts`:

```ts
import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const ACTOR_COOKIE = 'pw_actor';
const ACTOR_KEY_PATTERN = /^act_[a-f0-9]{32}$/;

export function createActorKey(): string {
  return `act_${randomBytes(16).toString('hex')}`;
}

export function isValidActorKey(value: string | undefined): value is string {
  return typeof value === 'string' && ACTOR_KEY_PATTERN.test(value);
}

export function getOrSetActorKey(request: FastifyRequest, reply: FastifyReply): string {
  const existing = request.cookies[ACTOR_COOKIE];
  if (isValidActorKey(existing)) {
    return existing;
  }

  const actorKey = createActorKey();
  reply.setCookie(ACTOR_COOKIE, actorKey, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365
  });
  return actorKey;
}

export function hashIpAddress(ipAddress: string, secret: string): string {
  return createHmac('sha256', secret).update(ipAddress).digest('hex');
}

export function getRequestIp(request: FastifyRequest): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim().length > 0) {
    return forwardedFor.split(',')[0]!.trim();
  }
  return request.ip;
}
```

- [ ] **Step 4: Write failing cooldown tests**

Write `apps/server/test/cooldownService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryCooldownStore, checkAndConsumeCooldown } from '../src/services/cooldownService';

describe('checkAndConsumeCooldown', () => {
  it('allows first placement and blocks the next placement until cooldown expires', async () => {
    const store = new InMemoryCooldownStore();
    const first = await checkAndConsumeCooldown(store, 'actor-a', 1000, 10000);
    expect(first).toEqual({ allowed: true, nextAvailableAtMs: 11000, remainingMs: 0 });

    const second = await checkAndConsumeCooldown(store, 'actor-a', 5000, 10000);
    expect(second).toEqual({ allowed: false, nextAvailableAtMs: 11000, remainingMs: 6000 });

    const third = await checkAndConsumeCooldown(store, 'actor-a', 11000, 10000);
    expect(third).toEqual({ allowed: true, nextAvailableAtMs: 21000, remainingMs: 0 });
  });
});
```

- [ ] **Step 5: Run cooldown test and verify failure**

Run:

```bash
npm run test --workspace @pixel-world/server -- cooldownService.test.ts
```

Expected: FAIL because `cooldownService` does not exist.

- [ ] **Step 6: Implement cooldown service**

Write `apps/server/src/services/cooldownService.ts`:

```ts
import Redis from 'ioredis';

export interface CooldownStore {
  getNextAvailableAt(actorKey: string): Promise<number | null>;
  setNextAvailableAt(actorKey: string, nextAvailableAtMs: number, ttlMs: number): Promise<void>;
}

export interface CooldownResult {
  allowed: boolean;
  nextAvailableAtMs: number;
  remainingMs: number;
}

export class RedisCooldownStore implements CooldownStore {
  constructor(private readonly redis: Redis) {}

  async getNextAvailableAt(actorKey: string): Promise<number | null> {
    const value = await this.redis.get(`cooldown:${actorKey}`);
    return value ? Number(value) : null;
  }

  async setNextAvailableAt(actorKey: string, nextAvailableAtMs: number, ttlMs: number): Promise<void> {
    await this.redis.set(`cooldown:${actorKey}`, String(nextAvailableAtMs), 'PX', ttlMs);
  }
}

export class InMemoryCooldownStore implements CooldownStore {
  private readonly values = new Map<string, number>();

  async getNextAvailableAt(actorKey: string): Promise<number | null> {
    return this.values.get(actorKey) ?? null;
  }

  async setNextAvailableAt(actorKey: string, nextAvailableAtMs: number): Promise<void> {
    this.values.set(actorKey, nextAvailableAtMs);
  }
}

export async function checkAndConsumeCooldown(
  store: CooldownStore,
  actorKey: string,
  nowMs: number,
  cooldownMs: number
): Promise<CooldownResult> {
  const existingNextAvailableAt = await store.getNextAvailableAt(actorKey);
  if (existingNextAvailableAt && existingNextAvailableAt > nowMs) {
    return {
      allowed: false,
      nextAvailableAtMs: existingNextAvailableAt,
      remainingMs: existingNextAvailableAt - nowMs
    };
  }

  const nextAvailableAtMs = nowMs + cooldownMs;
  await store.setNextAvailableAt(actorKey, nextAvailableAtMs, cooldownMs * 2);
  return { allowed: true, nextAvailableAtMs, remainingMs: 0 };
}
```

- [ ] **Step 7: Implement Fastify app shell**

Write `apps/server/src/app.ts`:

```ts
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import Redis from 'ioredis';
import type { ServerConfig } from './config';
import { createDbPool } from './db/index';

export async function buildApp(config: ServerConfig) {
  const app = Fastify({ logger: true });
  const db = createDbPool(config);
  const redis = new Redis(config.redisUrl);

  app.decorate('db', db);
  app.decorate('redis', redis);
  app.decorate('config', config);

  await app.register(cors, {
    origin: config.webOrigin,
    credentials: true
  });

  await app.register(cookie, {
    secret: config.cookieSecret
  });

  app.get('/health', async () => ({ ok: true }));

  app.addHook('onClose', async () => {
    await db.end();
    redis.disconnect();
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof createDbPool>;
    redis: Redis;
    config: ServerConfig;
  }
}
```

Write `apps/server/src/index.ts`:

```ts
import { buildApp } from './app';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 8: Verify server core**

Run:

```bash
npm run test --workspace @pixel-world/server -- actorIdentity.test.ts cooldownService.test.ts
npm run typecheck --workspace @pixel-world/server
```

Expected: PASS.

- [ ] **Step 9: Commit server core**

Run:

```bash
git add apps/server/src/auth apps/server/src/services apps/server/src/app.ts apps/server/src/index.ts apps/server/test/actorIdentity.test.ts apps/server/test/cooldownService.test.ts
git commit -m "Add anonymous actor identity and cooldown foundations" \
  -m "Constraint: MVP participation is login-free but still requires cooldown and moderation signals.\nRejected: Client-only cooldown | It can be bypassed and would not support admin enforcement.\nConfidence: high\nScope-risk: narrow\nDirective: Keep actor keys anonymous and avoid exposing raw IP data.\nTested: npm run test --workspace @pixel-world/server -- actorIdentity.test.ts cooldownService.test.ts; npm run typecheck --workspace @pixel-world/server.\nNot-tested: Redis-backed cooldown under load is not exercised yet."
```

Expected: commit succeeds.

---

### Task 5: Realtime Socket.IO pixel flow

**Files:**
- Create: `apps/server/src/realtime/socketServer.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/db/canvasRepository.ts`
- Modify: `apps/server/test/pixelFlow.test.ts`

- [ ] **Step 1: Extend repository with restore-friendly event helpers**

Modify `apps/server/src/db/canvasRepository.ts` to export `getRecentEvents` and `upsertPixelAndLog` from Task 3 if they are not already exported. Keep the function signatures exactly as written in Task 3 so realtime and admin code share one mutation path.

Run:

```bash
npm run typecheck --workspace @pixel-world/server
```

Expected: PASS.

- [ ] **Step 2: Write Socket.IO server module**

Write `apps/server/src/realtime/socketServer.ts`:

```ts
import { createServer } from 'node:http';
import {
  DEFAULT_CANVAS_ID,
  normalizeHexColor,
  validateCoordinate,
  type PlacementRejectedPayload
} from '@pixel-world/shared';
import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { getOrSetActorKey, getRequestIp, hashIpAddress } from '../auth/actorIdentity';
import { getCanvasSnapshot, getRecentEvents, upsertPixelAndLog } from '../db/canvasRepository';
import { RedisCooldownStore, checkAndConsumeCooldown } from '../services/cooldownService';

function reject(reason: PlacementRejectedPayload['reason'], message: string, remainingMs?: number) {
  return { reason, message, remainingMs } satisfies PlacementRejectedPayload;
}

export async function attachSocketServer(app: FastifyInstance) {
  const httpServer = createServer(app.server);
  const io = new Server(httpServer, {
    cors: {
      origin: app.config.webOrigin,
      credentials: true
    }
  });

  const cooldownStore = new RedisCooldownStore(app.redis);
  let onlineCount = 0;

  io.on('connection', async (socket) => {
    onlineCount += 1;
    io.emit('presenceUpdated', { onlineCount });

    const request = socket.request as Parameters<typeof getOrSetActorKey>[0];
    const reply = {
      setCookie: () => undefined
    } as unknown as Parameters<typeof getOrSetActorKey>[1];
    const actorKey = getOrSetActorKey(request, reply);
    const actorIpHash = hashIpAddress(getRequestIp(request), app.config.ipHashSecret);

    try {
      const snapshot = await getCanvasSnapshot(app.db, DEFAULT_CANVAS_ID);
      const recentEvents = await getRecentEvents(app.db, DEFAULT_CANVAS_ID, 20);
      socket.emit('canvasSnapshot', {
        ...snapshot,
        recentEvents,
        onlineCount,
        nextAvailableAt: new Date().toISOString()
      });
    } catch {
      socket.emit('placementRejected', reject('server_error', 'Unable to load canvas snapshot'));
    }

    socket.on('placePixel', async (payload) => {
      try {
        if (!payload || payload.canvasId !== DEFAULT_CANVAS_ID) {
          socket.emit('placementRejected', reject('invalid_canvas', 'Unknown canvas'));
          return;
        }

        const coordinate = validateCoordinate(app.config.policy, Number(payload.x), Number(payload.y));
        if (!coordinate.ok) {
          socket.emit('placementRejected', reject('invalid_coordinate', coordinate.reason));
          return;
        }

        const colorHex = normalizeHexColor(String(payload.colorHex));
        if (!colorHex) {
          socket.emit('placementRejected', reject('invalid_color', 'Use a valid HEX color'));
          return;
        }

        const nowMs = Date.now();
        const cooldown = await checkAndConsumeCooldown(
          cooldownStore,
          actorKey,
          nowMs,
          app.config.policy.cooldownMs
        );

        if (!cooldown.allowed) {
          socket.emit(
            'placementRejected',
            reject('cooldown_active', 'Pixel cooldown is still active', cooldown.remainingMs)
          );
          socket.emit('cooldownUpdated', {
            nextAvailableAt: new Date(cooldown.nextAvailableAtMs).toISOString(),
            remainingMs: cooldown.remainingMs
          });
          return;
        }

        const event = await upsertPixelAndLog(app.db, {
          canvasId: DEFAULT_CANVAS_ID,
          x: Number(payload.x),
          y: Number(payload.y),
          colorHex,
          actorKey,
          actorIpHash,
          source: 'user'
        });

        io.emit('pixelUpdated', {
          canvasId: DEFAULT_CANVAS_ID,
          x: event.x,
          y: event.y,
          colorHex: event.newColorHex,
          updatedAt: event.createdAt
        });

        const recentEvents = await getRecentEvents(app.db, DEFAULT_CANVAS_ID, 20);
        io.emit('recentEventsUpdated', { events: recentEvents });
        socket.emit('cooldownUpdated', {
          nextAvailableAt: new Date(cooldown.nextAvailableAtMs).toISOString(),
          remainingMs: 0
        });
      } catch {
        socket.emit('placementRejected', reject('server_error', 'Unable to place pixel'));
      }
    });

    socket.on('disconnect', () => {
      onlineCount = Math.max(0, onlineCount - 1);
      io.emit('presenceUpdated', { onlineCount });
    });
  });

  return { httpServer, io };
}
```

- [ ] **Step 3: Replace server startup with shared HTTP server**

Modify `apps/server/src/index.ts`:

```ts
import { buildApp } from './app';
import { loadConfig } from './config';
import { attachSocketServer } from './realtime/socketServer';

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);
  const { httpServer } = await attachSocketServer(app);

  await app.ready();
  httpServer.listen(config.port, '0.0.0.0', () => {
    app.log.info(`Pixel World server listening on ${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Verify realtime server compiles**

Run:

```bash
npm run typecheck --workspace @pixel-world/server
```

Expected: PASS. If Fastify request typing around Socket.IO request is too narrow, add a small adapter function in `actorIdentity.ts` rather than weakening validation logic.

- [ ] **Step 5: Add integration coverage for accepted pixel flow**

Extend `apps/server/test/pixelFlow.test.ts` with this assertion after the existing repository test:

```ts
it('records previous color when a pixel is overwritten', async () => {
  await upsertPixelAndLog(pool, {
    canvasId: 'global',
    x: 8,
    y: 9,
    colorHex: '#EF4444',
    actorKey: 'actor-a',
    actorIpHash: 'ip-hash-a',
    source: 'user'
  });

  const overwrite = await upsertPixelAndLog(pool, {
    canvasId: 'global',
    x: 8,
    y: 9,
    colorHex: '#22C55E',
    actorKey: 'actor-b',
    actorIpHash: 'ip-hash-b',
    source: 'user'
  });

  expect(overwrite.previousColorHex).toBe('#EF4444');
  expect(overwrite.newColorHex).toBe('#22C55E');
});
```

Run:

```bash
npm run test --workspace @pixel-world/server -- pixelFlow.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit realtime flow**

Run:

```bash
git add apps/server/src/realtime apps/server/src/index.ts apps/server/src/db/canvasRepository.ts apps/server/test/pixelFlow.test.ts
git commit -m "Broadcast accepted pixel changes in realtime" \
  -m "Constraint: Connected users must see accepted pixel updates without manual refresh.\nRejected: Polling snapshots for MVP realtime | It would weaken the collaboration feel approved in the design.\nConfidence: medium\nScope-risk: moderate\nDirective: Broadcast only after server validation and persistence succeed.\nTested: npm run typecheck --workspace @pixel-world/server; npm run test --workspace @pixel-world/server -- pixelFlow.test.ts.\nNot-tested: Browser-to-browser Socket.IO flow waits for web and e2e tasks."
```

Expected: commit succeeds.

---

### Task 6: Admin API authentication, logs, restore, and blocks

**Files:**
- Create: `apps/server/src/auth/adminSession.ts`
- Create: `apps/server/src/admin/adminRoutes.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/db/canvasRepository.ts`
- Create: `apps/server/test/adminRoutes.test.ts`

- [ ] **Step 1: Write admin session helper**

Write `apps/server/src/auth/adminSession.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'pw_admin';

export function createAdminSessionToken(secret: string): string {
  const issuedAt = Date.now().toString();
  const signature = createHmac('sha256', secret).update(issuedAt).digest('hex');
  return `${issuedAt}.${signature}`;
}

export function verifyAdminSessionToken(token: string | undefined, secret: string, maxAgeMs: number): boolean {
  if (!token) return false;
  const [issuedAt, signature] = token.split('.');
  if (!issuedAt || !signature) return false;

  const issuedAtMs = Number(issuedAt);
  if (!Number.isFinite(issuedAtMs) || Date.now() - issuedAtMs > maxAgeMs) return false;

  const expected = createHmac('sha256', secret).update(issuedAt).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function isCorrectAdminPassword(input: string, expected: string): boolean {
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);
  return inputBuffer.length === expectedBuffer.length && timingSafeEqual(inputBuffer, expectedBuffer);
}
```

- [ ] **Step 2: Extend repository for admin operations**

Add these functions to `apps/server/src/db/canvasRepository.ts`:

```ts
export async function logAdminAction(
  db: DbClient,
  actionType: string,
  targetSummary: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await db.query(
    `INSERT INTO admin_actions (action_type, target_summary, metadata)
     VALUES ($1, $2, $3::jsonb)`,
    [actionType, targetSummary, JSON.stringify(metadata)]
  );
}

export async function createBlock(
  db: DbClient,
  input: {
    actorKey?: string;
    actorIpHash?: string;
    reason: string;
    expiresAt: Date;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO blocks (actor_key, actor_ip_hash, reason, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [input.actorKey ?? null, input.actorIpHash ?? null, input.reason, input.expiresAt]
  );
}
```

- [ ] **Step 3: Implement admin routes**

Write `apps/server/src/admin/adminRoutes.ts`:

```ts
import { DEFAULT_CANVAS_ID, normalizeHexColor, validateCoordinate } from '@pixel-world/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ADMIN_COOKIE, createAdminSessionToken, isCorrectAdminPassword, verifyAdminSessionToken } from '../auth/adminSession';
import { createBlock, getRecentEvents, logAdminAction, upsertPixelAndLog } from '../db/canvasRepository';

const ADMIN_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 4;

function requireAdmin(request: FastifyRequest, reply: FastifyReply, secret: string): boolean {
  const token = request.cookies[ADMIN_COOKIE];
  if (!verifyAdminSessionToken(token, secret, ADMIN_SESSION_MAX_AGE_MS)) {
    reply.code(401).send({ error: 'admin_session_required' });
    return false;
  }
  return true;
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post('/admin/login', async (request, reply) => {
    const body = request.body as { password?: string };
    if (!isCorrectAdminPassword(String(body.password ?? ''), app.config.adminPassword)) {
      reply.code(401).send({ error: 'invalid_admin_password' });
      return;
    }

    reply.setCookie(ADMIN_COOKIE, createAdminSessionToken(app.config.cookieSecret), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: ADMIN_SESSION_MAX_AGE_MS / 1000
    });
    return { ok: true };
  });

  app.get('/admin/events', async (request, reply) => {
    if (!requireAdmin(request, reply, app.config.cookieSecret)) return;
    return { events: await getRecentEvents(app.db, DEFAULT_CANVAS_ID, 100) };
  });

  app.post('/admin/restore/pixel', async (request, reply) => {
    if (!requireAdmin(request, reply, app.config.cookieSecret)) return;
    const body = request.body as { x?: number; y?: number; colorHex?: string };
    const x = Number(body.x);
    const y = Number(body.y);
    const coordinate = validateCoordinate(app.config.policy, x, y);
    const colorHex = normalizeHexColor(String(body.colorHex ?? ''));

    if (!coordinate.ok || !colorHex) {
      reply.code(400).send({ error: 'invalid_restore_request' });
      return;
    }

    const event = await upsertPixelAndLog(app.db, {
      canvasId: DEFAULT_CANVAS_ID,
      x,
      y,
      colorHex,
      actorKey: 'admin',
      actorIpHash: 'admin',
      source: 'admin'
    });
    await logAdminAction(app.db, 'restore_pixel', `${x},${y}`, { colorHex });
    return { event };
  });

  app.post('/admin/restore/area', async (request, reply) => {
    if (!requireAdmin(request, reply, app.config.cookieSecret)) return;
    const body = request.body as { fromX?: number; fromY?: number; toX?: number; toY?: number; colorHex?: string };
    const fromX = Number(body.fromX);
    const fromY = Number(body.fromY);
    const toX = Number(body.toX);
    const toY = Number(body.toY);
    const colorHex = normalizeHexColor(String(body.colorHex ?? ''));

    if (!colorHex || !validateCoordinate(app.config.policy, fromX, fromY).ok || !validateCoordinate(app.config.policy, toX, toY).ok) {
      reply.code(400).send({ error: 'invalid_restore_request' });
      return;
    }

    const minX = Math.min(fromX, toX);
    const maxX = Math.max(fromX, toX);
    const minY = Math.min(fromY, toY);
    const maxY = Math.max(fromY, toY);
    const events = [];

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        events.push(await upsertPixelAndLog(app.db, {
          canvasId: DEFAULT_CANVAS_ID,
          x,
          y,
          colorHex,
          actorKey: 'admin',
          actorIpHash: 'admin',
          source: 'admin'
        }));
      }
    }

    await logAdminAction(app.db, 'restore_area', `${minX},${minY}-${maxX},${maxY}`, { colorHex, count: events.length });
    return { events };
  });

  app.post('/admin/blocks', async (request, reply) => {
    if (!requireAdmin(request, reply, app.config.cookieSecret)) return;
    const body = request.body as { actorKey?: string; actorIpHash?: string; reason?: string; durationMinutes?: number };
    const durationMinutes = Number(body.durationMinutes ?? 60);
    if ((!body.actorKey && !body.actorIpHash) || !body.reason || durationMinutes <= 0) {
      reply.code(400).send({ error: 'invalid_block_request' });
      return;
    }

    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
    await createBlock(app.db, {
      actorKey: body.actorKey,
      actorIpHash: body.actorIpHash,
      reason: body.reason,
      expiresAt
    });
    await logAdminAction(app.db, 'block_actor', body.actorKey ?? body.actorIpHash!, { reason: body.reason, expiresAt: expiresAt.toISOString() });
    return { ok: true, expiresAt: expiresAt.toISOString() };
  });
}
```

- [ ] **Step 4: Register admin routes**

Modify `apps/server/src/app.ts` to import and register admin routes after cookie registration:

```ts
import { registerAdminRoutes } from './admin/adminRoutes';
```

Then add inside `buildApp` after `/health` route:

```ts
await registerAdminRoutes(app);
```

- [ ] **Step 5: Add admin route smoke tests**

Write `apps/server/test/adminRoutes.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { runMigrations } from '../src/db/migrate';

describe('admin routes', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it('rejects admin events without session and accepts login with configured password', async () => {
    const app = await buildApp(loadConfig());
    const denied = await app.inject({ method: 'GET', url: '/admin/events' });
    expect(denied.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/admin/login',
      payload: { password: loadConfig().adminPassword }
    });
    expect(login.statusCode).toBe(200);
    expect(login.cookies.some((cookie) => cookie.name === 'pw_admin')).toBe(true);

    await app.close();
  });
});
```

- [ ] **Step 6: Verify admin API**

Run:

```bash
npm run test --workspace @pixel-world/server -- adminRoutes.test.ts
npm run typecheck --workspace @pixel-world/server
```

Expected: PASS.

- [ ] **Step 7: Commit admin API**

Run:

```bash
git add apps/server/src/auth/adminSession.ts apps/server/src/admin apps/server/src/app.ts apps/server/src/db/canvasRepository.ts apps/server/test/adminRoutes.test.ts
git commit -m "Add password-protected admin operations" \
  -m "Constraint: Login-free MVP still needs operational recovery and temporary blocking.\nRejected: Admin URL token | It can leak through history and logs.\nConfidence: medium\nScope-risk: moderate\nDirective: Keep admin APIs behind a session cookie and log admin mutations.\nTested: npm run test --workspace @pixel-world/server -- adminRoutes.test.ts; npm run typecheck --workspace @pixel-world/server.\nNot-tested: Browser admin UI and realtime broadcast of admin restores are not wired yet."
```

Expected: commit succeeds.

---

### Task 7: Next.js shell and soft-retro UI primitives

**Files:**
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/components/ColorTools.tsx`
- Create: `apps/web/src/components/StatusBar.tsx`
- Create: `apps/web/src/components/RecentEvents.tsx`

- [ ] **Step 1: Create app layout and global styles**

Write `apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pixel World',
  description: 'A shared realtime pixel canvas.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Write `apps/web/src/app/globals.css`:

```css
:root {
  color-scheme: dark;
  --bg: #111827;
  --panel: #1f2937;
  --panel-soft: #273449;
  --line: #475569;
  --text: #f8fafc;
  --muted: #cbd5e1;
  --accent: #7dd3fc;
  --accent-2: #f9a8d4;
  --danger: #fb7185;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: radial-gradient(circle at top left, #334155 0, var(--bg) 32rem);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

button,
input {
  font: inherit;
}

button {
  cursor: pointer;
}

.page-shell {
  width: min(1180px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 28px 0 40px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.brand {
  margin: 0;
  font-size: clamp(28px, 5vw, 56px);
  letter-spacing: 0.04em;
  text-shadow: 3px 3px 0 #334155;
}

.panel {
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  border: 2px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.28);
  padding: 16px;
}

.main-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) 320px;
  gap: 18px;
  align-items: start;
}

@media (max-width: 860px) {
  .main-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Create presentational controls**

Write `apps/web/src/components/ColorTools.tsx`:

```tsx
'use client';

import { DEFAULT_PALETTE, hexToRgb, normalizeHexColor, type HexColor } from '@pixel-world/shared';

interface ColorToolsProps {
  selectedColor: HexColor;
  eyedropperColor: HexColor | null;
  onColorChange: (color: HexColor) => void;
}

export function ColorTools({ selectedColor, eyedropperColor, onColorChange }: ColorToolsProps) {
  const rgb = eyedropperColor ? hexToRgb(eyedropperColor) : null;

  return (
    <section className="panel" aria-label="Color tools">
      <h2>Toolbox</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {DEFAULT_PALETTE.map((color) => (
          <button
            key={color}
            aria-label={`Select ${color}`}
            onClick={() => onColorChange(color)}
            style={{
              aspectRatio: '1',
              border: color === selectedColor ? '3px solid var(--accent)' : '1px solid var(--line)',
              borderRadius: 8,
              background: color
            }}
          />
        ))}
      </div>
      <label style={{ display: 'grid', gap: 6, marginTop: 14 }}>
        HEX
        <input
          value={selectedColor}
          onChange={(event) => {
            const normalized = normalizeHexColor(event.target.value);
            if (normalized) onColorChange(normalized);
          }}
          style={{ padding: 10, borderRadius: 10, border: '1px solid var(--line)' }}
        />
      </label>
      <div style={{ marginTop: 14, color: 'var(--muted)' }}>
        <strong>Eyedropper</strong>
        <div>{eyedropperColor ?? 'Select a pixel'}</div>
        {rgb ? <div>RGB {rgb.r}, {rgb.g}, {rgb.b}</div> : null}
      </div>
    </section>
  );
}
```

Write `apps/web/src/components/StatusBar.tsx`:

```tsx
'use client';

interface StatusBarProps {
  onlineCount: number;
  remainingMs: number;
  connected: boolean;
}

export function StatusBar({ onlineCount, remainingMs, connected }: StatusBarProps) {
  return (
    <section className="panel" aria-label="Canvas status">
      <div>ONLINE {onlineCount}</div>
      <div>NEXT PIXEL {Math.ceil(remainingMs / 1000)}s</div>
      <div>{connected ? 'CONNECTED' : 'RECONNECTING'}</div>
    </section>
  );
}
```

Write `apps/web/src/components/RecentEvents.tsx`:

```tsx
'use client';

import type { RecentPixelEvent } from '@pixel-world/shared';

export function RecentEvents({ events }: { events: RecentPixelEvent[] }) {
  return (
    <section className="panel" aria-label="Recent pixel changes">
      <h2>Recent</h2>
      <ol style={{ paddingLeft: 18, color: 'var(--muted)' }}>
        {events.slice(0, 8).map((event) => (
          <li key={event.id}>
            {event.newColorHex} at {event.x},{event.y}
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 3: Create temporary page shell**

Write `apps/web/src/app/page.tsx`:

```tsx
'use client';

import { DEFAULT_PALETTE, type HexColor } from '@pixel-world/shared';
import { useState } from 'react';
import { ColorTools } from '../components/ColorTools';
import { RecentEvents } from '../components/RecentEvents';
import { StatusBar } from '../components/StatusBar';

export default function HomePage() {
  const [selectedColor, setSelectedColor] = useState<HexColor>(DEFAULT_PALETTE[9]!);

  return (
    <main className="page-shell">
      <header className="header">
        <h1 className="brand">PIXEL WORLD</h1>
        <div>GLOBAL 100×100</div>
      </header>
      <div className="main-grid">
        <section className="panel" style={{ minHeight: 520 }}>
          Canvas loads in the realtime task.
        </section>
        <aside style={{ display: 'grid', gap: 14 }}>
          <StatusBar onlineCount={0} remainingMs={0} connected={false} />
          <ColorTools selectedColor={selectedColor} eyedropperColor={null} onColorChange={setSelectedColor} />
          <RecentEvents events={[]} />
        </aside>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify web shell**

Run:

```bash
npm run typecheck --workspace @pixel-world/web
npm run build --workspace @pixel-world/web
```

Expected: PASS.

- [ ] **Step 5: Commit web shell**

Run:

```bash
git add apps/web/src/app apps/web/src/components
git commit -m "Create the soft-retro Pixel World web shell" \
  -m "Constraint: MVP needs a browser UI centered on the global canvas and pixel tools.\nRejected: A plain debug-only page | It would not match the approved soft-retro direction.\nConfidence: high\nScope-risk: narrow\nDirective: Keep client components presentational until server-driven state is wired.\nTested: npm run typecheck --workspace @pixel-world/web; npm run build --workspace @pixel-world/web.\nNot-tested: Realtime canvas interaction is not wired yet."
```

Expected: commit succeeds.

---

### Task 8: Canvas rendering, eyedropper, and realtime client state

**Files:**
- Create: `apps/web/src/components/CanvasBoard.tsx`
- Create: `apps/web/src/lib/socketClient.ts`
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/test/canvasBoard.test.tsx`

- [ ] **Step 1: Write canvas board interaction test**

Write `apps/web/test/canvasBoard.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasBoard } from '../src/components/CanvasBoard';

const pixels = [{ x: 1, y: 2, colorHex: '#38BDF8' as const, updatedAt: new Date().toISOString() }];

describe('CanvasBoard', () => {
  it('calls eyedropper and placement callbacks for a clicked pixel', () => {
    const onInspectPixel = vi.fn();
    const onPlacePixel = vi.fn();

    render(
      <CanvasBoard
        width={100}
        height={100}
        pixels={pixels}
        defaultColorHex="#FFFFFF"
        selectedColor="#EF4444"
        canPlacePixel
        onInspectPixel={onInspectPixel}
        onPlacePixel={onPlacePixel}
      />
    );

    const pixel = screen.getByLabelText('Pixel 1,2');
    fireEvent.click(pixel);

    expect(onInspectPixel).toHaveBeenCalledWith('#38BDF8');
    expect(onPlacePixel).toHaveBeenCalledWith(1, 2);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm run test --workspace @pixel-world/web -- canvasBoard.test.tsx
```

Expected: FAIL because `CanvasBoard` does not exist.

- [ ] **Step 3: Implement CanvasBoard with DOM grid for MVP**

Write `apps/web/src/components/CanvasBoard.tsx`:

```tsx
'use client';

import type { HexColor, PixelRecord } from '@pixel-world/shared';

interface CanvasBoardProps {
  width: number;
  height: number;
  pixels: PixelRecord[];
  defaultColorHex: HexColor;
  selectedColor: HexColor;
  canPlacePixel: boolean;
  onInspectPixel: (color: HexColor) => void;
  onPlacePixel: (x: number, y: number) => void;
}

export function CanvasBoard({
  width,
  height,
  pixels,
  defaultColorHex,
  canPlacePixel,
  onInspectPixel,
  onPlacePixel
}: CanvasBoardProps) {
  const colors = new Map(pixels.map((pixel) => [`${pixel.x},${pixel.y}`, pixel.colorHex]));
  const cells = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = colors.get(`${x},${y}`) ?? defaultColorHex;
      cells.push(
        <button
          key={`${x},${y}`}
          aria-label={`Pixel ${x},${y}`}
          disabled={!canPlacePixel}
          onClick={() => {
            onInspectPixel(color);
            onPlacePixel(x, y);
          }}
          style={{ background: color }}
        />
      );
    }
  }

  return (
    <section className="panel" aria-label="Global pixel canvas">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${width}, minmax(3px, 1fr))`,
          gap: 1,
          background: '#0f172a',
          border: '3px solid var(--line)',
          padding: 6,
          aspectRatio: '1',
          overflow: 'hidden'
        }}
      >
        {cells}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Implement Socket.IO client helper**

Write `apps/web/src/lib/socketClient.ts`:

```ts
import { io } from 'socket.io-client';

export function createPixelSocket() {
  return io(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000', {
    withCredentials: true,
    transports: ['websocket', 'polling']
  });
}
```

- [ ] **Step 5: Wire homepage to realtime events**

Replace `apps/web/src/app/page.tsx` with:

```tsx
'use client';

import {
  DEFAULT_CANVAS_COLOR,
  DEFAULT_CANVAS_ID,
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_PALETTE,
  type CanvasSnapshotPayload,
  type HexColor,
  type PixelRecord,
  type RecentPixelEvent
} from '@pixel-world/shared';
import { useEffect, useMemo, useState } from 'react';
import { CanvasBoard } from '../components/CanvasBoard';
import { ColorTools } from '../components/ColorTools';
import { RecentEvents } from '../components/RecentEvents';
import { StatusBar } from '../components/StatusBar';
import { createPixelSocket } from '../lib/socketClient';

export default function HomePage() {
  const [selectedColor, setSelectedColor] = useState<HexColor>(DEFAULT_PALETTE[9]!);
  const [eyedropperColor, setEyedropperColor] = useState<HexColor | null>(null);
  const [pixels, setPixels] = useState<PixelRecord[]>([]);
  const [recentEvents, setRecentEvents] = useState<RecentPixelEvent[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);

  const pixelSocket = useMemo(() => createPixelSocket(), []);

  useEffect(() => {
    pixelSocket.on('connect', () => setConnected(true));
    pixelSocket.on('disconnect', () => setConnected(false));
    pixelSocket.on('canvasSnapshot', (snapshot: CanvasSnapshotPayload) => {
      setPixels(snapshot.pixels);
      setRecentEvents(snapshot.recentEvents);
      setOnlineCount(snapshot.onlineCount);
    });
    pixelSocket.on('pixelUpdated', (pixel: PixelRecord) => {
      setPixels((current) => {
        const withoutCurrent = current.filter((item) => !(item.x === pixel.x && item.y === pixel.y));
        return [...withoutCurrent, pixel];
      });
    });
    pixelSocket.on('presenceUpdated', ({ onlineCount: count }: { onlineCount: number }) => setOnlineCount(count));
    pixelSocket.on('recentEventsUpdated', ({ events }: { events: RecentPixelEvent[] }) => setRecentEvents(events));
    pixelSocket.on('cooldownUpdated', ({ remainingMs: nextRemainingMs }: { remainingMs: number }) => setRemainingMs(nextRemainingMs));
    pixelSocket.on('placementRejected', ({ remainingMs: nextRemainingMs }: { remainingMs?: number }) => {
      if (typeof nextRemainingMs === 'number') setRemainingMs(nextRemainingMs);
    });

    return () => {
      pixelSocket.disconnect();
    };
  }, [pixelSocket]);

  useEffect(() => {
    if (remainingMs <= 0) return;
    const id = window.setInterval(() => setRemainingMs((value) => Math.max(0, value - 1000)), 1000);
    return () => window.clearInterval(id);
  }, [remainingMs]);

  return (
    <main className="page-shell">
      <header className="header">
        <h1 className="brand">PIXEL WORLD</h1>
        <div>GLOBAL 100×100</div>
      </header>
      <div className="main-grid">
        <CanvasBoard
          width={DEFAULT_CANVAS_WIDTH}
          height={DEFAULT_CANVAS_HEIGHT}
          pixels={pixels}
          defaultColorHex={DEFAULT_CANVAS_COLOR}
          selectedColor={selectedColor}
          canPlacePixel={connected && remainingMs === 0}
          onInspectPixel={setEyedropperColor}
          onPlacePixel={(x, y) => pixelSocket.emit('placePixel', { canvasId: DEFAULT_CANVAS_ID, x, y, colorHex: selectedColor })}
        />
        <aside style={{ display: 'grid', gap: 14 }}>
          <StatusBar onlineCount={onlineCount} remainingMs={remainingMs} connected={connected} />
          <ColorTools selectedColor={selectedColor} eyedropperColor={eyedropperColor} onColorChange={setSelectedColor} />
          <RecentEvents events={recentEvents} />
        </aside>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Verify canvas UI**

Run:

```bash
npm run test --workspace @pixel-world/web -- canvasBoard.test.tsx
npm run typecheck --workspace @pixel-world/web
```

Expected: PASS.

- [ ] **Step 7: Commit realtime web UI**

Run:

```bash
git add apps/web/src/components/CanvasBoard.tsx apps/web/src/lib/socketClient.ts apps/web/src/app/page.tsx apps/web/test/canvasBoard.test.tsx
git commit -m "Wire the public canvas to realtime pixel state" \
  -m "Constraint: MVP users need live canvas updates, color selection, and eyedropper feedback.\nRejected: Rendering only static snapshots | It would not satisfy realtime collaboration.\nConfidence: medium\nScope-risk: moderate\nDirective: Keep server as source of truth; client state mirrors snapshots and accepted updates.\nTested: npm run test --workspace @pixel-world/web -- canvasBoard.test.tsx; npm run typecheck --workspace @pixel-world/web.\nNot-tested: Full browser-to-browser update path waits for e2e."
```

Expected: commit succeeds.

---

### Task 9: Admin web UI

**Files:**
- Create: `apps/web/src/components/AdminPanel.tsx`
- Create: `apps/web/src/app/admin/page.tsx`

- [ ] **Step 1: Implement admin panel component**

Write `apps/web/src/components/AdminPanel.tsx`:

```tsx
'use client';

import { DEFAULT_CANVAS_COLOR, type RecentPixelEvent } from '@pixel-world/shared';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export function AdminPanel() {
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [events, setEvents] = useState<RecentPixelEvent[]>([]);
  const [message, setMessage] = useState('');

  async function login() {
    await api('/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
    setLoggedIn(true);
    setMessage('Admin session active');
  }

  async function loadEvents() {
    const data = await api('/admin/events');
    setEvents(data.events);
  }

  async function restoreFirstEventToDefault() {
    const first = events[0];
    if (!first) return;
    await api('/admin/restore/pixel', {
      method: 'POST',
      body: JSON.stringify({ x: first.x, y: first.y, colorHex: DEFAULT_CANVAS_COLOR })
    });
    setMessage(`Restored ${first.x},${first.y} to ${DEFAULT_CANVAS_COLOR}`);
    await loadEvents();
  }

  return (
    <main className="page-shell">
      <h1 className="brand">ADMIN</h1>
      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        {!loggedIn ? (
          <>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={{ display: 'block', marginTop: 8, padding: 10, width: '100%' }}
              />
            </label>
            <button onClick={login}>Log in</button>
          </>
        ) : (
          <>
            <button onClick={loadEvents}>Load recent events</button>
            <button onClick={restoreFirstEventToDefault}>Restore newest event to white</button>
            <p>{message}</p>
            <ol>
              {events.map((event) => (
                <li key={event.id}>
                  {event.newColorHex} at {event.x},{event.y} by {event.actorKey}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Create admin page**

Write `apps/web/src/app/admin/page.tsx`:

```tsx
import { AdminPanel } from '../../components/AdminPanel';

export default function AdminPage() {
  return <AdminPanel />;
}
```

- [ ] **Step 3: Verify admin web UI**

Run:

```bash
npm run typecheck --workspace @pixel-world/web
npm run build --workspace @pixel-world/web
```

Expected: PASS.

- [ ] **Step 4: Commit admin UI**

Run:

```bash
git add apps/web/src/components/AdminPanel.tsx apps/web/src/app/admin/page.tsx
git commit -m "Expose MVP admin tools in the web app" \
  -m "Constraint: Operators need password-protected log review and recovery tools in MVP.\nRejected: Internal API-only administration | It would slow operational recovery during live use.\nConfidence: medium\nScope-risk: moderate\nDirective: Keep admin UI minimal and route all authority through server sessions.\nTested: npm run typecheck --workspace @pixel-world/web; npm run build --workspace @pixel-world/web.\nNot-tested: Admin restore in a browser waits for e2e."
```

Expected: commit succeeds.

---

### Task 10: End-to-end browser verification

**Files:**
- Create: `apps/e2e/tests/pixel-world.spec.ts`
- Modify: `apps/web/src/components/CanvasBoard.tsx`
- Modify: `apps/web/src/components/ColorTools.tsx`

- [ ] **Step 1: Add stable test selectors through accessible labels**

Ensure `CanvasBoard` keeps labels in the exact format `Pixel x,y`, and `ColorTools` buttons keep labels in the exact format `Select #RRGGBB`. These labels already exist from earlier tasks; do not replace them with non-accessible selectors.

Run:

```bash
npm run test --workspace @pixel-world/web -- canvasBoard.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Write E2E test**

Write `apps/e2e/tests/pixel-world.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('two visitors see a realtime pixel update and eyedropper color', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();

  await first.goto('/');
  await second.goto('/');

  await first.getByRole('button', { name: 'Select #EF4444' }).click();
  await first.getByLabel('Pixel 1,2').click();

  await expect(second.getByLabel('Pixel 1,2')).toHaveCSS('background-color', 'rgb(239, 68, 68)');
  await second.getByLabel('Pixel 1,2').click();
  await expect(second.getByText('#EF4444')).toBeVisible();

  await first.close();
  await second.close();
});
```

- [ ] **Step 3: Run full local stack for E2E**

In terminal A:

```bash
docker compose up -d db redis
npm run migrate
npm run dev:server
```

Expected: server logs show it is listening on port `4000`.

In terminal B:

```bash
npm run dev:web
```

Expected: Next.js logs show it is listening on port `3000`.

In terminal C:

```bash
npm run e2e
```

Expected: PASS. If the first placement is rejected due to old cooldown state in Redis, run `docker compose exec redis redis-cli FLUSHDB` and rerun E2E.

- [ ] **Step 4: Commit E2E coverage**

Run:

```bash
git add apps/e2e/tests/pixel-world.spec.ts apps/web/src/components/CanvasBoard.tsx apps/web/src/components/ColorTools.tsx
git commit -m "Verify realtime pixel collaboration end to end" \
  -m "Constraint: MVP completion requires proof that two browser sessions observe the same accepted pixel change.\nRejected: Relying only on unit tests | They cannot prove Socket.IO plus browser rendering integration.\nConfidence: medium\nScope-risk: moderate\nDirective: Keep accessible labels stable because E2E and users both depend on them.\nTested: docker compose up -d db redis; npm run migrate; npm run dev:server; npm run dev:web; npm run e2e.\nNot-tested: High-concurrency load is outside MVP verification."
```

Expected: commit succeeds.

---

### Task 11: Full-stack scripts, documentation, and final verification

**Files:**
- Modify: `package.json`
- Create: `README.md`
- Modify: `.gitignore` if generated local files appear during development

- [ ] **Step 1: Add root convenience scripts**

Modify root `package.json` scripts to include:

```json
{
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "dev:server": "npm run dev --workspace @pixel-world/server",
    "dev:web": "npm run dev --workspace @pixel-world/web",
    "migrate": "npm run migrate --workspace @pixel-world/server",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "e2e": "npm run test --workspace @pixel-world/e2e",
    "verify": "npm run typecheck && npm run test && npm run build"
  }
}
```

Preserve existing root fields while adding `verify`.

- [ ] **Step 2: Write README**

Write `README.md`:

```md
# Pixel World

Pixel World is a shared realtime pixel canvas. The MVP provides one anonymous global `100 × 100` canvas where visitors can place one pixel every 10 seconds, inspect colors with an eyedropper, and see other visitors' changes in real time.

## Stack

- Next.js + React + TypeScript web/admin UI
- Fastify + Socket.IO realtime/API server
- PostgreSQL for canvas state and event logs
- Redis for cooldowns and future multi-node Socket.IO coordination
- Docker Compose for local data services

## Local setup

```bash
cp .env.example .env
npm install
docker compose up -d db redis
npm run migrate
```

In one terminal:

```bash
npm run dev:server
```

In another terminal:

```bash
npm run dev:web
```

Open http://localhost:3000.

## Admin

Open http://localhost:3000/admin and use the `ADMIN_PASSWORD` configured in `.env`.

## Verification

```bash
npm run typecheck
npm run test
npm run build
npm run e2e
```

`npm run e2e` expects the server and web app to be running locally with PostgreSQL and Redis available.

## MVP policy values

- Canvas id: `global`
- Size: `100 × 100`
- Default color: `#FFFFFF`
- Cooldown: `10` seconds
- Overwrite policy: always overwrite
```

- [ ] **Step 3: Run final verification**

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Expected: PASS.

Then run the full-stack smoke:

```bash
docker compose up -d db redis
npm run migrate
npm run e2e
```

Expected: PASS when web and server dev processes are running.

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intentional source, docs, and lockfile changes are present before commit.

- [ ] **Step 5: Commit documentation and verification scripts**

Run:

```bash
git add package.json package-lock.json README.md .gitignore
git commit -m "Document local operation and verification for Pixel World" \
  -m "Constraint: The MVP must be runnable and verifiable by a developer with no project context.\nRejected: Keeping setup steps implicit | It would make handoff and deployment preparation fragile.\nConfidence: high\nScope-risk: narrow\nDirective: Update README whenever ports, env vars, or verification commands change.\nTested: npm run typecheck; npm run test; npm run build; docker compose up -d db redis; npm run migrate; npm run e2e.\nNot-tested: Production deployment hardening is outside this MVP plan."
```

Expected: commit succeeds.

---

## Final acceptance checklist

Run this checklist before claiming the MVP is complete:

- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.
- [ ] `npm run build` passes.
- [ ] `docker compose up -d db redis` succeeds.
- [ ] `npm run migrate` succeeds.
- [ ] `npm run dev:server` starts the API/realtime server.
- [ ] `npm run dev:web` starts the Next.js app.
- [ ] `npm run e2e` passes with server and web running.
- [ ] Manual browser check: anonymous visitor can place one pixel.
- [ ] Manual browser check: second browser sees the update in real time.
- [ ] Manual browser check: eyedropper shows HEX and RGB for a selected pixel.
- [ ] Manual browser check: cooldown blocks rapid repeat placement.
- [ ] Manual browser check: `/admin` login works with `ADMIN_PASSWORD`.
- [ ] Manual browser check: admin can view events and restore a pixel.
- [ ] `git status --short` shows no unintended files.

## Self-review against spec

Spec coverage:

- One global `100 × 100` canvas: Tasks 2, 3, 8.
- Login-free participation: Tasks 4, 5.
- 10-second cooldown: Tasks 2, 4, 5, 10.
- Always-overwrite policy: Tasks 2, 3, 5.
- Realtime updates: Tasks 5, 8, 10.
- Palette and HEX input: Tasks 2, 7, 8.
- Eyedropper HEX/RGB: Tasks 2, 7, 8, 10.
- Online count and recent changes: Tasks 5, 7, 8.
- Persistent state: Task 3.
- Admin password/session: Tasks 6, 9.
- Logs, restore, block: Tasks 3, 6, 9.
- Configurable policy values: Task 2.
- Docker-based local stack: Tasks 1, 11.
- Testing and verification: Tasks 2 through 11.

Plan quality checks:

- No unresolved requirement gaps remain.
- Types and event names are consistent: `canvasSnapshot`, `placePixel`, `pixelUpdated`, `cooldownUpdated`, `presenceUpdated`, `recentEventsUpdated`, `placementRejected`.
- Central policy names are consistent: `DEFAULT_CANVAS_ID`, `DEFAULT_CANVAS_WIDTH`, `DEFAULT_CANVAS_HEIGHT`, `DEFAULT_COOLDOWN_MS`, `OVERWRITE_POLICY_ALWAYS`.
- Commit messages follow the repository Lore commit protocol.
