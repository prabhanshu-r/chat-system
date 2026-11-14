CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT,
  supabase_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_user_id_unique
  ON users (supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  title VARCHAR(80),
  direct_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversations_title_type_check CHECK (
    (is_group AND title IS NOT NULL AND direct_key IS NULL)
    OR (NOT is_group AND title IS NULL AND direct_key IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS conversations_direct_key_unique
  ON conversations (direct_key)
  WHERE direct_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_members_user_idx
  ON conversation_members (user_id, conversation_id);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(1000) NOT NULL CHECK (LENGTH(BTRIM(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at DESC);
