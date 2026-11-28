-- +goose Up
ALTER TABLE gigs ADD COLUMN work_stage text NOT NULL DEFAULT 'assigned'
    CHECK (work_stage IN ('assigned', 'arrived', 'started'));

-- +goose Down
ALTER TABLE gigs DROP COLUMN work_stage;
