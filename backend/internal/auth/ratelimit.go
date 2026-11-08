package auth

import (
	"net/http"
	"net/netip"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

type attemptWindow struct {
	count   int
	expires time.Time
}

type ipLimiter struct {
	mu       sync.Mutex
	entries  map[string]attemptWindow
	limit    int
	capacity int
	window   time.Duration
	now      func() time.Time
}

func newIPLimiter(limit int) *ipLimiter {
	return &ipLimiter{entries: make(map[string]attemptWindow), limit: limit, capacity: 4096, window: time.Minute, now: time.Now}
}

func (l *ipLimiter) retryAfter(ip string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if addr, err := netip.ParseAddr(ip); err == nil {
		ip = addr.Unmap().String()
	} else {
		ip = "unknown"
	}
	entry, exists := l.entries[ip]
	if !exists || !now.Before(entry.expires) {
		if len(l.entries) >= l.capacity {
			wait := l.window
			for key, value := range l.entries {
				if !now.Before(value.expires) {
					delete(l.entries, key)
				} else {
					wait = min(wait, value.expires.Sub(now))
				}
			}
			if len(l.entries) >= l.capacity {
				return int((wait + time.Second - 1) / time.Second)
			}
		}
		entry = attemptWindow{expires: now.Add(l.window)}
	}
	if entry.count >= l.limit {
		return int((entry.expires.Sub(now) + time.Second - 1) / time.Second)
	}
	entry.count++
	l.entries[ip] = entry
	return 0
}

func (l *ipLimiter) middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if wait := l.retryAfter(c.ClientIP()); wait > 0 {
			c.Header("Retry-After", strconv.Itoa(wait))
			httpapi.Fail(c, http.StatusTooManyRequests, "RATE_LIMITED", "Слишком много попыток. Подождите немного и попробуйте ещё раз.")
			return
		}
		c.Next()
	}
}
