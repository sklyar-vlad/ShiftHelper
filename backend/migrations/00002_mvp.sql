-- +goose Up
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email varchar(254) NOT NULL UNIQUE CHECK (email <> '' AND email = lower(btrim(email))),
    password_hash text NOT NULL CHECK (password_hash <> ''),
    role text NOT NULL CHECK (role IN ('customer', 'worker')),
    name varchar(100) NOT NULL CHECK (btrim(name) <> ''),
    bio varchar(1000) NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE gigs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES users(id),
    selected_worker_id uuid,
    title varchar(150) NOT NULL CHECK (btrim(title) <> ''),
    description varchar(5000) NOT NULL CHECK (btrim(description) <> ''),
    requirements varchar(2000) NOT NULL DEFAULT '',
    city varchar(100) NOT NULL CHECK (btrim(city) <> ''),
    address varchar(300) NOT NULL CHECK (btrim(address) <> ''),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    amount_kopecks bigint NOT NULL CHECK (amount_kopecks BETWEEN 1 AND 10000000000),
    status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'awaiting_confirmation', 'completed', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    submitted_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,
    CHECK (customer_id <> selected_worker_id),
    CHECK ((status IN ('open', 'cancelled')) = (selected_worker_id IS NULL)),
    CHECK ((status IN ('awaiting_confirmation', 'completed')) = (submitted_at IS NOT NULL)),
    CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
    CHECK (completed_at >= submitted_at)
);

CREATE TABLE applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    gig_id uuid NOT NULL REFERENCES gigs(id),
    worker_id uuid NOT NULL REFERENCES users(id),
    comment varchar(1000) NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'selected', 'rejected', 'withdrawn')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (gig_id, worker_id)
);

ALTER TABLE gigs ADD CONSTRAINT gigs_selected_application_fk
    FOREIGN KEY (id, selected_worker_id) REFERENCES applications (gig_id, worker_id);

CREATE UNIQUE INDEX applications_selected_idx ON applications (gig_id) WHERE status = 'selected';
CREATE INDEX applications_gig_idx ON applications (gig_id, created_at DESC, id DESC);
CREATE INDEX applications_worker_idx ON applications (worker_id, created_at DESC, id DESC);
CREATE INDEX gigs_catalog_idx ON gigs (created_at DESC, id DESC) WHERE status = 'open';
CREATE INDEX gigs_city_idx ON gigs (lower(city), created_at DESC, id DESC) WHERE status = 'open';
CREATE INDEX gigs_customer_idx ON gigs (customer_id, created_at DESC, id DESC);
CREATE INDEX gigs_worker_idx ON gigs (selected_worker_id, created_at DESC, id DESC)
    WHERE selected_worker_id IS NOT NULL;

-- +goose Down
ALTER TABLE gigs DROP CONSTRAINT gigs_selected_application_fk;
DROP TABLE applications;
DROP TABLE gigs;
DROP TABLE sessions;
DROP TABLE users;
