-- =============================================
-- Hanomad Flow OS: Feedback System Tables
-- =============================================

-- 1. suggestions: 사용자 건의사항
CREATE TABLE IF NOT EXISTS suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '익명',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '기타',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. reactions: 건의 공감 (중복 방지)
-- fingerprint: 브라우저별 고유 ID (localStorage UUID)
-- emoji: 공감 종류 (👍 좋아요, 🔥 급해요, 💡 좋은아이디어)
CREATE TABLE IF NOT EXISTS reactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  suggestion_id UUID NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(suggestion_id, emoji, fingerprint)
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_suggestions_created_at ON suggestions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reactions_suggestion_id ON reactions(suggestion_id);
CREATE INDEX IF NOT EXISTS idx_reactions_fingerprint ON reactions(fingerprint);

-- 4. RLS (Row Level Security)
ALTER TABLE suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "suggestions_read" ON suggestions FOR SELECT USING (true);
CREATE POLICY "reactions_read" ON reactions FOR SELECT USING (true);

-- Anonymous insert access
CREATE POLICY "suggestions_insert" ON suggestions FOR INSERT WITH CHECK (true);
CREATE POLICY "reactions_insert" ON reactions FOR INSERT WITH CHECK (true);

-- Reactions delete (allow removing own reaction by fingerprint)
CREATE POLICY "reactions_delete" ON reactions FOR DELETE USING (true);

-- 5. View: suggestion with reaction counts
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
