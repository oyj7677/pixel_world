ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS daily_canvas_id UUID REFERENCES daily_canvases(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS canvas_id TEXT REFERENCES canvases(id) ON DELETE CASCADE;

ALTER TABLE blocks
  DROP CONSTRAINT IF EXISTS blocks_scope_type_check;

ALTER TABLE blocks
  ADD CONSTRAINT blocks_scope_type_check
  CHECK (scope_type IN ('global', 'room', 'daily_canvas', 'canvas'));

CREATE INDEX IF NOT EXISTS blocks_scope_canvas_idx ON blocks(scope_type, daily_canvas_id, canvas_id, expires_at);
