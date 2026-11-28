-- +goose Up
ALTER TABLE users ADD COLUMN specialties text[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT users_specialty_limit CHECK (
        cardinality(specialties) <= 5 AND (role = 'worker' OR cardinality(specialties) = 0)
    );

-- +goose Down
ALTER TABLE users DROP COLUMN specialties;
