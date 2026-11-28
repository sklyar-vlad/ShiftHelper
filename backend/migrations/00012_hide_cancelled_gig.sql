-- +goose Up
ALTER TABLE gigs ADD COLUMN hidden_from_customer boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT gigs_hide_cancelled_only CHECK (NOT hidden_from_customer OR status = 'cancelled');

-- +goose Down
ALTER TABLE gigs DROP COLUMN hidden_from_customer;
