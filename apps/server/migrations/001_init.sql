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
  x INTEGER NOT NULL CONSTRAINT pixels_x_nonnegative_check CHECK (x >= 0),
  y INTEGER NOT NULL CONSTRAINT pixels_y_nonnegative_check CHECK (y >= 0),
  color_hex TEXT NOT NULL CHECK (color_hex ~ '^#[0-9A-F]{6}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_actor_key TEXT NOT NULL,
  PRIMARY KEY (canvas_id, x, y)
);

CREATE TABLE IF NOT EXISTS pixel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  x INTEGER NOT NULL CONSTRAINT pixel_events_x_nonnegative_check CHECK (x >= 0),
  y INTEGER NOT NULL CONSTRAINT pixel_events_y_nonnegative_check CHECK (y >= 0),
  previous_color_hex TEXT CHECK (previous_color_hex IS NULL OR previous_color_hex ~ '^#[0-9A-F]{6}$'),
  new_color_hex TEXT NOT NULL CHECK (new_color_hex ~ '^#[0-9A-F]{6}$'),
  actor_key TEXT NOT NULL,
  actor_ip_hash TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pixel_events_canvas_created_idx
  ON pixel_events(canvas_id, created_at DESC);


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pixels_x_nonnegative_check'
  ) THEN
    ALTER TABLE pixels ADD CONSTRAINT pixels_x_nonnegative_check CHECK (x >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pixels_y_nonnegative_check'
  ) THEN
    ALTER TABLE pixels ADD CONSTRAINT pixels_y_nonnegative_check CHECK (y >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pixel_events_x_nonnegative_check'
  ) THEN
    ALTER TABLE pixel_events ADD CONSTRAINT pixel_events_x_nonnegative_check CHECK (x >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pixel_events_y_nonnegative_check'
  ) THEN
    ALTER TABLE pixel_events ADD CONSTRAINT pixel_events_y_nonnegative_check CHECK (y >= 0);
  END IF;
END $$;

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
