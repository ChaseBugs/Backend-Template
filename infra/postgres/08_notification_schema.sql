SET search_path TO notification;

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID UNIQUE NOT NULL,
  user_id     UUID NOT NULL,                          -- ref: auth.users.id
  type        VARCHAR(50) NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  queued_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(50) UNIQUE NOT NULL,
  title_tpl   TEXT NOT NULL,
  body_tpl    TEXT NOT NULL,
  channels    TEXT[] NOT NULL DEFAULT '{}'            -- email, push, sms, in-app
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notification.notifications(id) ON DELETE CASCADE,
  channel         VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL','PUSH','SMS')),
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  provider_id     VARCHAR(255),
  last_error      TEXT,
  delivered_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (notification_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notification.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read    ON notification.notifications(user_id, is_read) WHERE NOT is_read;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notification.notifications(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_event ON notification.notifications(event_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON notification.notification_deliveries(status);
