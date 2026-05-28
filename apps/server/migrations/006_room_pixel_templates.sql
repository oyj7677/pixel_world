CREATE TABLE IF NOT EXISTS room_pixel_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_by_member_id UUID NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0 AND char_length(name) <= 80),
  width INTEGER NOT NULL CHECK (width BETWEEN 16 AND 64),
  height INTEGER NOT NULL CHECK (height BETWEEN 16 AND 64),
  default_color_hex TEXT NOT NULL CHECK (default_color_hex ~ '^#[0-9A-F]{6}$'),
  pixels JSONB NOT NULL CHECK (jsonb_typeof(pixels) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS room_pixel_templates_one_active_idx
  ON room_pixel_templates(room_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS room_pixel_templates_room_updated_idx
  ON room_pixel_templates(room_id, updated_at DESC);
