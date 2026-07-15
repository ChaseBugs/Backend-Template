SET search_path TO notification;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_event_id_key;
DROP INDEX IF EXISTS notification.uq_notifications_event;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_event_user
  ON notification.notifications(event_id, user_id);
