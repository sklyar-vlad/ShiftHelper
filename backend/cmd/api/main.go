package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/sklyar-vlad/ShiftHelper/backend/internal/config"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/migrations"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/postgres"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/redis"
)

func main() {
	logger, err := zap.NewProduction()
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "create logger: %v\n", err)
		os.Exit(1)
	}
	defer func() { _ = logger.Sync() }()

	if err := run(logger); err != nil {
		logger.Error("server stopped", zap.Error(err))
		_ = logger.Sync()
		os.Exit(1)
	}
}

func run(logger *zap.Logger) error {
	cfg := config.NewConfig()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := postgres.New(ctx, cfg.Database)
	if err != nil {
		return err
	}
	defer pool.Close()
	cache, err := redis.New(cfg.Redis)
	if err != nil {
		return err
	}
	defer func() { _ = cache.Close() }()

	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		if len(os.Args) != 3 {
			return errors.New("usage: /server migrate up|down|status|version")
		}
		migrationCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		return migrations.Run(migrationCtx, pool, os.Args[2], os.Stdout)
	}
	startupCtx, cancelStartup := context.WithTimeout(ctx, 15*time.Second)
	defer cancelStartup()
	if err := migrations.Check(startupCtx, pool); err != nil {
		return fmt.Errorf("check database migrations: %w", err)
	}
	if len(os.Args) > 1 {
		return errors.New("usage: /server [migrate up|down|status|version]")
	}
	gin.SetMode(gin.ReleaseMode)
	router := handler.NewRouter(logger, pool, os.Getenv("METRICS_TOKEN"))

	server := &http.Server{
		Addr:              net.JoinHostPort("", cfg.Server.Port),
		Handler:           router,
		ErrorLog:          zap.NewStdLog(logger),
		ReadTimeout:       cfg.Server.ReadTimeout,
		ReadHeaderTimeout: cfg.Server.ReadHeaderTimeout,
		WriteTimeout:      cfg.Server.WriteTimeout,
		IdleTimeout:       cfg.Server.IdleTimeout,
	}

	return serve(ctx, server, logger, cfg.Server.ShutdownTimeout)
}

func serve(ctx context.Context, server *http.Server, logger *zap.Logger, shutdownTimeout time.Duration) error {
	if ctx.Err() != nil {
		return nil
	}

	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return fmt.Errorf("listen HTTP: %w", err)
	}

	result := make(chan error, 1)
	go func() {
		result <- server.Serve(listener)
	}()
	logger.Info("service started", zap.String("addr", listener.Addr().String()))

	select {
	case err := <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve HTTP: %w", err)
	case <-ctx.Done():
	}
	logger.Info("shutdown signal received")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", zap.Error(err))
		closeErr := server.Close()
		<-result
		return errors.Join(fmt.Errorf("shutdown HTTP: %w", err), closeErr)
	}

	if err := <-result; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve HTTP: %w", err)
	}
	logger.Info("server stopped gracefully")

	return nil
}
