package redis

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/config"
)

type Cache struct{ client *goredis.Client }

func New(cfg config.Redis) (*Cache, error) {
	if cfg.URL == "" {
		return nil, nil
	}
	options, err := goredis.ParseURL(cfg.URL)
	if err != nil {
		return nil, errors.New("invalid Redis configuration")
	}
	options.DialTimeout = 100 * time.Millisecond
	options.ReadTimeout = 50 * time.Millisecond
	options.WriteTimeout = 50 * time.Millisecond
	options.PoolTimeout = 50 * time.Millisecond
	options.MaxRetries = -1
	options.DialerRetries = 1
	options.ContextTimeoutEnabled = true
	return &Cache{client: goredis.NewClient(options)}, nil
}

func (c *Cache) Close() error {
	if c == nil {
		return nil
	}
	return c.client.Close()
}

func Key(resource string, version int64, parameters any) string {
	data, err := json.Marshal(parameters)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("shifthelper:cache:v1:%s:%d:%x", resource, version, sha256.Sum256(data))
}

func (c *Cache) Get(ctx context.Context, key string, result any) bool {
	if c == nil || key == "" {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	data, err := c.client.Get(ctx, key).Bytes()
	return err == nil && len(data) <= 1<<20 && json.Unmarshal(data, result) == nil
}

func (c *Cache) Set(ctx context.Context, key string, value any) {
	if c == nil || key == "" {
		return
	}
	data, err := json.Marshal(value)
	if err != nil || len(data) > 1<<20 {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	_ = c.client.Set(ctx, key, data, time.Minute).Err()
}
