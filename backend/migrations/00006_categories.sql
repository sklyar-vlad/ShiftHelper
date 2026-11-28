-- +goose Up
CREATE TABLE gig_categories (
    code text PRIMARY KEY,
    name text NOT NULL,
    position smallint NOT NULL UNIQUE
);
INSERT INTO gig_categories (code, name, position) VALUES
    ('repair', 'Ремонт и сборка', 1),
    ('electrical', 'Электрика', 2),
    ('plumbing', 'Сантехника', 3),
    ('cleaning', 'Уборка', 4),
    ('moving', 'Переезды и погрузка', 5),
    ('delivery', 'Доставка', 6),
    ('retail', 'Торговля и обслуживание', 7),
    ('warehouse', 'Склад и упаковка', 8),
    ('events', 'Мероприятия', 9),
    ('other', 'Другое', 10);
ALTER TABLE gigs ADD COLUMN category text NOT NULL DEFAULT 'other' REFERENCES gig_categories(code);

-- +goose Down
ALTER TABLE gigs DROP COLUMN category;
DROP TABLE gig_categories;
