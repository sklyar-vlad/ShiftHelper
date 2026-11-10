-- +goose Up
ALTER TABLE users ADD COLUMN contact varchar(200) NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE users DROP COLUMN contact;
