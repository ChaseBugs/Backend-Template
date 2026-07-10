SET search_path TO notification;

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,                          -- ref: auth.users.id
  type        VARCHAR(50) NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(50) UNIQUE NOT NULL,
  title_tpl   TEXT NOT NULL,
  body_tpl    TEXT NOT NULL,
  channels    TEXT[] NOT NULL DEFAULT '{}'            -- email, push, sms, in-app
);

CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notification.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read    ON notification.notifications(user_id, is_read) WHERE NOT is_read;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notification.notifications(created_at DESC);
