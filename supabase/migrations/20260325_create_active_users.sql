-- Active users heartbeat table
CREATE TABLE IF NOT EXISTS active_users (
  fingerprint TEXT PRIMARY KEY,
  last_seen TIMESTAMPTZ DEFAULT now()
);

-- Auto-cleanup: users not seen in 60 seconds are considered offline
-- (handled client-side, but this index helps cleanup queries)
CREATE INDEX IF NOT EXISTS idx_active_users_last_seen ON active_users(last_seen);

-- RLS
ALTER TABLE active_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "active_users_read" ON active_users FOR SELECT USING (true);
CREATE POLICY "active_users_upsert" ON active_users FOR INSERT WITH CHECK (true);
CREATE POLICY "active_users_update" ON active_users FOR UPDATE USING (true);
CREATE POLICY "active_users_delete" ON active_users FOR DELETE USING (true);

-- Function to get active user count (last 60 seconds)
CREATE OR REPLACE FUNCTION get_active_user_count()
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER FROM active_users WHERE last_seen > now() - interval '60 seconds';
$$ LANGUAGE sql SECURITY DEFINER;
