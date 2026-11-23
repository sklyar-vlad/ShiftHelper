-- +goose Up
ALTER TABLE gigs ADD COLUMN point jsonb,
    ADD CONSTRAINT gigs_point_valid CHECK (point IS NULL OR (
        jsonb_typeof(point) = 'object'
        AND jsonb_typeof(point->'latitude') = 'number'
        AND point->'latitude' BETWEEN '-90'::jsonb AND '90'::jsonb
        AND jsonb_typeof(point->'longitude') = 'number'
        AND point->'longitude' BETWEEN '-180'::jsonb AND '180'::jsonb
        AND point->>'source' IN ('manual', 'geoapify')
        AND (point->>'source' = 'manual' OR length(btrim(point->>'attribution')) BETWEEN 1 AND 300)
    ) IS TRUE);

-- +goose Down
ALTER TABLE gigs DROP COLUMN point;
