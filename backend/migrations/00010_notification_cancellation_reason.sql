-- +goose Up
ALTER TABLE notifications ADD COLUMN cancellation_reason text,
    ADD CHECK (cancellation_reason IS NULL OR (type = 'gig_cancelled' AND cancellation_reason IN (
        'no_longer_needed', 'schedule_changed', 'terms_changed', 'posted_by_mistake', 'other'
    )));

-- +goose Down
ALTER TABLE notifications DROP COLUMN cancellation_reason;
