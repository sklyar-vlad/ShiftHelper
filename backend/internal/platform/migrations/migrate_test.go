package migrations

import (
	"context"
	"crypto/rand"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMVPMigration(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL migration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal("invalid TEST_DATABASE_URL")
	}
	schema := pgx.Identifier{"migration_test_" + strings.ToLower(rand.Text())}.Sanitize()
	admin, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	}()
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	run := func(action string) {
		t.Helper()
		if err := Run(ctx, pool, action, io.Discard); err != nil {
			t.Fatal(err)
		}
	}
	run("up")
	if err := Check(ctx, pool); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, role, name) VALUES
		('00000000-0000-0000-0000-000000000001', 'customer@example.test', '$argon2id$test', 'customer', 'Customer'),
		('00000000-0000-0000-0000-000000000002', 'worker@example.test', '$argon2id$test', 'worker', 'Worker'),
		('00000000-0000-0000-0000-000000000003', 'worker2@example.test', '$argon2id$test', 'worker', 'Worker 2');
		INSERT INTO gigs (id, customer_id, title, description, city, address, starts_at, ends_at, amount_kopecks)
		VALUES ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001',
		'Moving', 'Help with boxes', 'Moscow', 'Example 1', now() + interval '1 day', now() + interval '2 days', 500000);
		INSERT INTO applications (gig_id, worker_id)
		SELECT '00000000-0000-0000-0000-000000000101', id FROM users WHERE role = 'worker';
		INSERT INTO sessions (token_hash, user_id, expires_at)
		VALUES (decode(repeat('ab', 32), 'hex'), '00000000-0000-0000-0000-000000000002', now() + interval '7 days');
	`)
	if err != nil {
		t.Fatal(err)
	}
	run("up")
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&count); err != nil || count != 3 {
		t.Fatalf("repeated migration lost data: count=%d, err=%v", count, err)
	}
	for _, tc := range []struct{ name, sql, code string }{
		{"duplicate email", "UPDATE users SET email = 'customer@example.test' WHERE role = 'worker'", "23505"},
		{"unnormalized email", "UPDATE users SET email = 'UPPER@example.test'", "23514"},
		{"invalid role", "UPDATE users SET role = 'admin'", "23514"},
		{"empty hash", "UPDATE users SET password_hash = ''", "23514"},
		{"negative amount", "UPDATE gigs SET amount_kopecks = -1", "23514"},
		{"zero amount", "UPDATE gigs SET amount_kopecks = 0", "23514"},
		{"excessive amount", "UPDATE gigs SET amount_kopecks = 10000000001", "23514"},
		{"reversed dates", "UPDATE gigs SET ends_at = starts_at", "23514"},
		{"invalid gig status", "UPDATE gigs SET status = 'draft'", "23514"},
		{"missing customer", "UPDATE gigs SET customer_id = gen_random_uuid()", "23503"},
		{"missing applicant", "UPDATE applications SET worker_id = gen_random_uuid()", "23503"},
		{"missing gig", "UPDATE applications SET gig_id = gen_random_uuid()", "23503"},
		{"duplicate application", "INSERT INTO applications (gig_id, worker_id) SELECT gig_id, worker_id FROM applications", "23505"},
		{"two selected workers", "UPDATE applications SET status = 'selected'", "23505"},
		{"invalid application status", "UPDATE applications SET status = 'accepted'", "23514"},
		{"worker without application", "UPDATE gigs SET status = 'in_progress', selected_worker_id = gen_random_uuid()", "23503"},
		{"completion without submission", "UPDATE gigs SET status = 'completed', completed_at = now()", "23514"},
		{"invalid session hash", "UPDATE sessions SET token_hash = decode('ab', 'hex')", "23514"},
		{"expired on creation", "UPDATE sessions SET expires_at = created_at", "23514"},
		{"orphan session", "UPDATE sessions SET user_id = gen_random_uuid()", "23503"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = tx.Rollback(ctx) }()
			_, err = tx.Exec(ctx, tc.sql)
			var pgerr *pgconn.PgError
			if !errors.As(err, &pgerr) || pgerr.Code != tc.code {
				t.Fatalf("expected SQLSTATE %s, got %v", tc.code, err)
			}
		})
	}
	_, err = pool.Exec(ctx, `
		UPDATE applications SET status = 'selected' WHERE worker_id = '00000000-0000-0000-0000-000000000002';
		UPDATE applications SET status = 'rejected' WHERE status = 'pending';
		UPDATE gigs SET status = 'in_progress', selected_worker_id = '00000000-0000-0000-0000-000000000002';
		UPDATE gigs SET status = 'awaiting_confirmation', submitted_at = now();
		UPDATE gigs SET status = 'completed', completed_at = now();
	`)
	if err != nil {
		t.Fatalf("valid lifecycle: %v", err)
	}
	run("down")
	var removed bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass(current_schema() || '.users') IS NULL").Scan(&removed); err != nil || !removed {
		t.Fatalf("domain tables were not removed: %v", err)
	}
	if err := Check(ctx, pool); err == nil {
		t.Fatal("Check accepted an outdated schema")
	}
	run("down")
	run("up")
	if err := Check(ctx, pool); err != nil {
		t.Fatal(err)
	}
}
