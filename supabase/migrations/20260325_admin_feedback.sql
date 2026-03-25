-- Add admin columns to suggestions
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT '접수';
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS admin_reply TEXT;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS admin_replied_at TIMESTAMPTZ;

-- Update the suggestion_stats view to include new columns
CREATE OR REPLACE VIEW suggestion_stats AS
SELECT
  s.*,
  COALESCE(r.thumbs_up, 0) AS thumbs_up,
  COALESCE(r.fire, 0) AS fire,
  COALESCE(r.idea, 0) AS idea,
  COALESCE(r.thumbs_up, 0) + COALESCE(r.fire, 0) + COALESCE(r.idea, 0) AS total_reactions
FROM suggestions s
LEFT JOIN (
  SELECT
    suggestion_id,
    COUNT(*) FILTER (WHERE emoji = '👍') AS thumbs_up,
    COUNT(*) FILTER (WHERE emoji = '🔥') AS fire,
    COUNT(*) FILTER (WHERE emoji = '💡') AS idea
  FROM reactions
  GROUP BY suggestion_id
) r ON s.id = r.suggestion_id;

-- Allow update for admin operations
CREATE POLICY "suggestions_update" ON suggestions FOR UPDATE USING (true);
-- Allow delete for admin
CREATE POLICY "suggestions_delete" ON suggestions FOR DELETE USING (true);
