CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
  description TEXT,
  privacy TEXT NOT NULL CHECK (privacy IN ('private', 'unlisted')) DEFAULT 'private',
  owner_actor_key TEXT NOT NULL,
  default_width INTEGER NOT NULL CHECK (default_width > 0),
  default_height INTEGER NOT NULL CHECK (default_height > 0),
  default_cooldown_ms INTEGER NOT NULL CHECK (default_cooldown_ms > 0),
  target_completion_ms INTEGER NOT NULL CHECK (target_completion_ms > 0),
  expected_participant_count INTEGER NOT NULL CHECK (expected_participant_count > 0),
  pixel_allowance_interval_ms INTEGER NOT NULL CHECK (pixel_allowance_interval_ms > 0),
  pixel_allowance_max_storage_ms INTEGER NOT NULL CHECK (pixel_allowance_max_storage_ms > 0),
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  actor_key TEXT NOT NULL,
  display_name TEXT,
  display_color TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  state TEXT NOT NULL CHECK (state IN ('active', 'left', 'blocked')) DEFAULT 'active',
  joined_via_invite_id UUID,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  UNIQUE (room_id, actor_key)
);

CREATE TABLE IF NOT EXISTS room_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  code_hash TEXT UNIQUE NOT NULL,
  created_by_member_id UUID REFERENCES room_members(id) ON DELETE SET NULL,
  role_on_join TEXT NOT NULL CHECK (role_on_join IN ('owner', 'admin', 'member', 'guest')) DEFAULT 'guest',
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_actor_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'room_members_joined_via_invite_id_fkey'
  ) THEN
    ALTER TABLE room_members
      ADD CONSTRAINT room_members_joined_via_invite_id_fkey
      FOREIGN KEY (joined_via_invite_id) REFERENCES room_invites(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS room_invite_uses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id UUID NOT NULL REFERENCES room_invites(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  actor_key TEXT NOT NULL,
  actor_ip_hash TEXT,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE canvases
  ADD COLUMN IF NOT EXISTS kind TEXT CHECK (kind IS NULL OR kind IN ('global', 'room_daily'));

CREATE TABLE IF NOT EXISTS daily_canvases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  canvas_date DATE NOT NULL,
  canvas_id TEXT UNIQUE NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'active', 'sealed', 'replay_ready')) DEFAULT 'active',
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  default_color_hex TEXT NOT NULL DEFAULT '#FFFFFF' CHECK (default_color_hex ~ '^#[0-9A-F]{6}$'),
  cooldown_ms INTEGER NOT NULL CHECK (cooldown_ms > 0),
  target_completion_ms INTEGER NOT NULL CHECK (target_completion_ms > 0),
  expected_participant_count INTEGER NOT NULL CHECK (expected_participant_count > 0),
  required_pixel_count INTEGER NOT NULL CHECK (required_pixel_count > 0),
  pixel_allowance_interval_ms INTEGER NOT NULL CHECK (pixel_allowance_interval_ms > 0),
  pixel_allowance_max_storage_ms INTEGER NOT NULL CHECK (pixel_allowance_max_storage_ms > 0),
  pacing_recalculated_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sealed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, canvas_date)
);

CREATE TABLE IF NOT EXISTS room_pixel_allowances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  actor_key TEXT NOT NULL,
  saved_count INTEGER NOT NULL DEFAULT 0 CHECK (saved_count >= 0),
  last_accrued_at TIMESTAMPTZ NOT NULL,
  last_spent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, actor_key)
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  room_public_id TEXT,
  actor_key TEXT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global', 'room')),
  ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE admin_actions
  ADD COLUMN IF NOT EXISTS scope_type TEXT CHECK (scope_type IS NULL OR scope_type IN ('global', 'room', 'daily_canvas', 'canvas')),
  ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS daily_canvas_id UUID REFERENCES daily_canvases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canvas_id TEXT REFERENCES canvases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_key TEXT;

CREATE INDEX IF NOT EXISTS rooms_public_id_idx ON rooms(public_id);
CREATE INDEX IF NOT EXISTS room_members_room_actor_idx ON room_members(room_id, actor_key);
CREATE INDEX IF NOT EXISTS room_invites_room_idx ON room_invites(room_id);
CREATE INDEX IF NOT EXISTS room_invites_code_hash_idx ON room_invites(code_hash);
CREATE INDEX IF NOT EXISTS room_invite_uses_invite_idx ON room_invite_uses(invite_id, used_at DESC);
CREATE INDEX IF NOT EXISTS daily_canvases_room_date_idx ON daily_canvases(room_id, canvas_date DESC);
CREATE INDEX IF NOT EXISTS room_pixel_allowances_room_actor_idx ON room_pixel_allowances(room_id, actor_key);
CREATE INDEX IF NOT EXISTS analytics_events_room_created_idx ON analytics_events(room_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS pixel_events_canvas_created_asc_idx ON pixel_events(canvas_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS blocks_scope_room_idx ON blocks(scope_type, room_id, expires_at);
CREATE INDEX IF NOT EXISTS admin_actions_scope_idx ON admin_actions(scope_type, room_id, daily_canvas_id, canvas_id, created_at DESC);
