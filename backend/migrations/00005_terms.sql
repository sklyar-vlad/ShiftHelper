-- +goose Up
ALTER TABLE gigs ADD COLUMN terms_version integer NOT NULL DEFAULT 1 CHECK (terms_version > 0);
ALTER TABLE applications ADD COLUMN terms_version integer NOT NULL DEFAULT 1 CHECK (terms_version > 0);
CREATE TABLE gig_changes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    gig_id uuid NOT NULL REFERENCES gigs(id),
    base_version integer NOT NULL CHECK (base_version > 0),
    terms jsonb NOT NULL CHECK (jsonb_typeof(terms) = 'object'),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'expired')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gig_changes_pending_idx ON gig_changes(gig_id) WHERE status = 'pending';

-- +goose Down
DROP TABLE gig_changes;
ALTER TABLE applications DROP COLUMN terms_version;
ALTER TABLE gigs DROP COLUMN terms_version;
