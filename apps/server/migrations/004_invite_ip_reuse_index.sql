CREATE INDEX IF NOT EXISTS room_invite_uses_invite_ip_idx
  ON room_invite_uses(invite_id, actor_ip_hash, used_at DESC)
  WHERE actor_ip_hash IS NOT NULL;
