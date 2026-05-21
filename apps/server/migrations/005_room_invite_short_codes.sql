ALTER TABLE room_invites
  ADD COLUMN IF NOT EXISTS short_code_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS room_invites_short_code_hash_idx
  ON room_invites(short_code_hash)
  WHERE short_code_hash IS NOT NULL;
