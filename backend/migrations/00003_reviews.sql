-- +goose Up
CREATE TABLE reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    gig_id uuid NOT NULL REFERENCES gigs(id),
    author_id uuid NOT NULL REFERENCES users(id),
    recipient_id uuid NOT NULL REFERENCES users(id),
    score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment varchar(1000) NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (author_id <> recipient_id),
    UNIQUE (gig_id, author_id)
);

CREATE INDEX reviews_recipient_idx ON reviews (recipient_id);

-- +goose Down
DROP TABLE reviews;
