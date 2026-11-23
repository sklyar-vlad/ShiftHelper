-- +goose Up
CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_key text NOT NULL CHECK (char_length(event_key) BETWEEN 1 AND 255),
    type text NOT NULL CHECK (type ~ '^[a-z][a-z0-9_]{0,63}$'),
    gig_id uuid REFERENCES gigs(id) ON DELETE SET NULL,
    gig_title text NOT NULL CHECK (char_length(gig_title) BETWEEN 1 AND 150),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    read_at timestamptz,
    UNIQUE (recipient_id, event_key)
);

CREATE INDEX notifications_recipient_recent_idx ON notifications (recipient_id, created_at DESC, id DESC);
CREATE INDEX notifications_recipient_unread_idx ON notifications (recipient_id) WHERE read_at IS NULL;

-- +goose Down
DROP TABLE notifications;
