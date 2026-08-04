-- PostgreSQL 15+ schema. 开发服务以 data/store.json 提供无需安装数据库的实现；
-- 生产环境可将 repository 层替换为此 schema 对应的 PostgreSQL 实现。
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encrypted_profile BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE search_inputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  normalized_text TEXT NOT NULL CHECK (char_length(normalized_text) BETWEEN 1 AND 4000),
  source VARCHAR(32) NOT NULL DEFAULT 'search-page',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX search_inputs_created_at_idx ON search_inputs(created_at DESC);

CREATE TABLE generation_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id UUID REFERENCES search_inputs(id),
  status VARCHAR(16) NOT NULL CHECK (status IN ('queued','processing','completed','failed')),
  request JSONB NOT NULL,
  result JSONB,
  error_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX generation_tasks_status_idx ON generation_tasks(status, created_at);

CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('audio','video','poster')),
  provider VARCHAR(64) NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES generation_tasks(id) ON DELETE CASCADE,
  question_type VARCHAR(16) NOT NULL CHECK (question_type IN ('choice','true_false','fill_blank')),
  difficulty VARCHAR(16) NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  content TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]',
  correct_answer JSONB NOT NULL,
  explanation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE answer_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  submitted_answer JSONB NOT NULL,
  is_correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
