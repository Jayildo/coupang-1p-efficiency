-- 누적 방문자 테이블
CREATE TABLE IF NOT EXISTS visitors (
  fingerprint TEXT PRIMARY KEY,
  first_seen TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "visitors_read" ON visitors FOR SELECT USING (true);
CREATE POLICY "visitors_insert" ON visitors FOR INSERT WITH CHECK (true);
