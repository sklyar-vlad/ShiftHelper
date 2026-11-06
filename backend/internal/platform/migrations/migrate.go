// Package migrations runs the project's embedded SQL migrations using Goose.
package migrations

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
	schema "github.com/sklyar-vlad/ShiftHelper/backend"
)

func migrationProvider(pool *pgxpool.Pool) (*goose.Provider, *sql.DB, error) {
	source, err := fs.Sub(schema.Migrations, "migrations")
	if err != nil {
		return nil, nil, err
	}
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return nil, nil, err
	}
	db := stdlib.OpenDBFromPool(pool)
	provider, err := goose.NewProvider(goose.DialectPostgres, db, source, goose.WithSessionLocker(locker))
	if err != nil {
		_ = db.Close()
		return nil, nil, err
	}
	return provider, db, nil
}

// Check prevents serving requests before Goose has applied the expected schema.
func Check(ctx context.Context, pool *pgxpool.Pool) error {
	provider, db, err := migrationProvider(pool)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	current, target, err := provider.GetVersions(ctx)
	if err != nil {
		return err
	}
	if current != target {
		return fmt.Errorf("database version %d, required %d: run task migrate:up", current, target)
	}
	pending, err := provider.HasPending(ctx)
	if err != nil {
		return err
	}
	if pending {
		return errors.New("pending database migrations: run task migrate:up")
	}
	return nil
}

// Run exposes Goose operations through the application image, with no host Goose install.
func Run(ctx context.Context, pool *pgxpool.Pool, action string, out io.Writer) error {
	provider, db, err := migrationProvider(pool)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	switch action {
	case "up":
		results, err := provider.Up(ctx)
		if err != nil {
			return err
		}
		for _, result := range results {
			if _, err := fmt.Fprintln(out, result); err != nil {
				return err
			}
		}
	case "down":
		result, err := provider.Down(ctx)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintln(out, result); err != nil {
			return err
		}
	case "status":
		statuses, err := provider.Status(ctx)
		if err != nil {
			return err
		}
		for _, status := range statuses {
			if _, err := fmt.Fprintf(out, "%s\t%s\n", status.State, status.Source.Path); err != nil {
				return err
			}
		}
	case "version":
	default:
		return errors.New("usage: /server migrate up|down|status|version")
	}
	version, err := provider.GetDBVersion(ctx)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(out, "Goose database version: %d\n", version)
	return err
}
