// Worker is reserved for future background jobs. No business jobs are implemented yet.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"go.uber.org/zap"
)

func main() {
	logger, err := zap.NewProduction()
	if err != nil {
		os.Exit(1)
	}
	defer func() { _ = logger.Sync() }()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	logger.Info("worker scaffold started; no job handlers configured")
	<-ctx.Done()
	logger.Info("worker stopped")
}
