CREATE TABLE IF NOT EXISTS problems (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  difficulty TEXT NOT NULL,
  category TEXT NOT NULL,
  statement TEXT NOT NULL,
  source TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  semantic_keywords TEXT[] NOT NULL DEFAULT '{}',
  retrieval_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  test_cases_blob_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_problems_difficulty ON problems(difficulty);
CREATE INDEX IF NOT EXISTS idx_problems_category ON problems(category);
CREATE INDEX IF NOT EXISTS idx_problems_tags ON problems USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_problems_keywords ON problems USING GIN(semantic_keywords);
CREATE INDEX IF NOT EXISTS idx_problems_meta ON problems USING GIN(retrieval_meta);

CREATE TABLE IF NOT EXISTS learner_profiles (
  learner_id TEXT PRIMARY KEY,
  user_id TEXT,
  anon_id TEXT,
  email TEXT,
  active_curriculum_key TEXT NOT NULL DEFAULT 'l33',
  active_problem_id INTEGER NOT NULL DEFAULT 1 REFERENCES problems(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id),
  UNIQUE(anon_id)
);
ALTER TABLE learner_profiles ADD COLUMN IF NOT EXISTS active_curriculum_key TEXT NOT NULL DEFAULT 'l33';

CREATE TABLE IF NOT EXISTS curriculums (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  total_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curriculum_problems (
  curriculum_key TEXT NOT NULL REFERENCES curriculums(key) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (curriculum_key, problem_id),
  UNIQUE (curriculum_key, position)
);

CREATE INDEX IF NOT EXISTS idx_curriculum_problems_key_pos ON curriculum_problems(curriculum_key, position);

CREATE TABLE IF NOT EXISTS problem_progress (
  learner_id TEXT NOT NULL REFERENCES learner_profiles(learner_id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unseen',
  confidence INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_assessment TEXT NOT NULL DEFAULT '',
  last_code TEXT NOT NULL DEFAULT '',
  model_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_practiced_at TIMESTAMPTZ,
  mastered_at TIMESTAMPTZ,
  PRIMARY KEY (learner_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_status ON problem_progress(status);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learner_profiles(learner_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);

CREATE TABLE IF NOT EXISTS credit_balances (
  learner_id TEXT PRIMARY KEY REFERENCES learner_profiles(learner_id) ON DELETE CASCADE,
  balance_femtodollars BIGINT NOT NULL DEFAULT 0,
  lifetime_spend_femtodollars BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id BIGSERIAL PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learner_profiles(learner_id) ON DELETE CASCADE,
  amount_femtodollars BIGINT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  balance_after BIGINT NOT NULL,
  stripe_session_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(stripe_session_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_learner ON credit_transactions(learner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_logs (
  id BIGSERIAL PRIMARY KEY,
  learner_id TEXT REFERENCES learner_profiles(learner_id) ON DELETE SET NULL,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cost_femtodollars BIGINT NOT NULL,
  charge_femtodollars BIGINT NOT NULL,
  openai_response_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_learner ON usage_logs(learner_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_problems_updated ON problems;
CREATE TRIGGER trg_problems_updated BEFORE UPDATE ON problems FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_profiles_updated ON learner_profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON learner_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_curriculums_updated ON curriculums;
CREATE TRIGGER trg_curriculums_updated BEFORE UPDATE ON curriculums FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_credit_balances_updated ON credit_balances;
CREATE TRIGGER trg_credit_balances_updated BEFORE UPDATE ON credit_balances FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_chat_sessions_updated ON chat_sessions;
CREATE TRIGGER trg_chat_sessions_updated BEFORE UPDATE ON chat_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
