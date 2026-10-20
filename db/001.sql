CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, email text UNIQUE, password_hash text, name text NOT NULL,
 role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin','guest')),
 verified boolean NOT NULL DEFAULT false, google_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_tokens (token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,kind text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS questions (
 id text PRIMARY KEY, slug text UNIQUE NOT NULL, title text NOT NULL, difficulty text NOT NULL,
 topics text[] NOT NULL, companies text[] NOT NULL, minutes int NOT NULL,
 published_version uuid, archived boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS question_topics ON questions USING gin(topics);
CREATE INDEX IF NOT EXISTS question_companies ON questions USING gin(companies);
CREATE INDEX IF NOT EXISTS question_difficulty ON questions(difficulty);
CREATE TABLE IF NOT EXISTS question_versions (
 id uuid PRIMARY KEY,question_id text NOT NULL REFERENCES questions ON DELETE CASCADE,version int NOT NULL,
 body jsonb NOT NULL,content_hash text NOT NULL,validation_status text NOT NULL DEFAULT 'unvalidated',
 validation_report jsonb,validation_started_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(question_id,version)
);
CREATE TABLE IF NOT EXISTS mocks (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,name text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('practice','timed')),dialect text NOT NULL,seed text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),deadline timestamptz NOT NULL,ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS mock_active ON mocks(deadline) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS mock_questions (
 mock_id uuid NOT NULL REFERENCES mocks ON DELETE CASCADE,position int NOT NULL,version_id uuid NOT NULL REFERENCES question_versions,
 draft text NOT NULL DEFAULT '',PRIMARY KEY(mock_id,position)
);
CREATE TABLE IF NOT EXISTS submissions (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,version_id uuid NOT NULL REFERENCES question_versions,
 mock_id uuid REFERENCES mocks ON DELETE CASCADE,position int,query text NOT NULL,dialect text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('run','submit','final')),state text NOT NULL DEFAULT 'queued',
 verdict text,result jsonb,created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz,
 UNIQUE(mock_id,position,mode)
);
-- Practice submissions do not set mock_id. In-mock runs use NULL position,
-- allowing repeated runs; exactly one frozen final per mock position.
CREATE INDEX IF NOT EXISTS submission_user ON submissions(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS submission_version ON submissions(version_id,mode,verdict);
CREATE INDEX IF NOT EXISTS submission_progress ON submissions(user_id,version_id,verdict) WHERE mode<>'run';
CREATE INDEX IF NOT EXISTS submission_queued ON submissions(created_at) WHERE state='queued';
CREATE TABLE IF NOT EXISTS bookmarks(user_id uuid REFERENCES users ON DELETE CASCADE,question_id text REFERENCES questions ON DELETE CASCADE,PRIMARY KEY(user_id,question_id));
CREATE TABLE IF NOT EXISTS audit(id bigserial PRIMARY KEY,user_id uuid REFERENCES users ON DELETE SET NULL,action text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE question_versions ADD COLUMN IF NOT EXISTS validation_started_at timestamptz;
