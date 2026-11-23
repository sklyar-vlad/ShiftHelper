-- +goose Up
ALTER TABLE gigs
    ADD COLUMN cancellation_reason text,
    ADD COLUMN cancellation_comment text NOT NULL DEFAULT '',
    ADD CONSTRAINT gigs_cancellation_details CHECK (
        (cancellation_reason IS NULL OR cancellation_reason IN (
            'no_longer_needed', 'schedule_changed', 'terms_changed', 'posted_by_mistake', 'other'
        ))
        AND char_length(cancellation_comment) <= 500
        AND (status = 'cancelled' OR (cancellation_reason IS NULL AND cancellation_comment = ''))
    );

-- +goose Down
ALTER TABLE gigs DROP COLUMN cancellation_comment, DROP COLUMN cancellation_reason;
