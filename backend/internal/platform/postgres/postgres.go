package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/config"
)

func New(ctx context.Context, cfg config.Database) (*pgxpool.Pool, error) {
	settings, err := pgxpool.ParseConfig(cfg.URL)
	if err != nil {
		return nil, errors.New("invalid PostgreSQL configuration")
	}
	settings.MaxConns = cfg.MaxConnections
	settings.ConnConfig.ConnectTimeout = cfg.ConnectTimeout
	settings.ConnConfig.RuntimeParams["timezone"] = "UTC"
	settings.AfterConnect = func(_ context.Context, conn *pgx.Conn) error {
		conn.TypeMap().RegisterType(&pgtype.Type{Name: "timestamptz", OID: pgtype.TimestamptzOID,
			Codec: &pgtype.TimestamptzCodec{ScanLocation: time.UTC}})
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, cfg.ConnectTimeout)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, settings)
	if err != nil {
		return nil, fmt.Errorf("create PostgreSQL pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect PostgreSQL: %w", err)
	}
	return pool, nil
}
