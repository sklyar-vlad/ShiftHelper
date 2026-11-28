package auth

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestIPLimiterWindowAndKeys(t *testing.T) {
	now := time.Unix(1000, 0)
	l := newIPLimiter(1)
	l.now = func() time.Time { return now }
	if l.retryAfter("192.0.2.1") != 0 || l.retryAfter("::ffff:192.0.2.1") != 60 {
		t.Fatal("IPv4 and mapped IPv4 must share a limit")
	}
	if l.retryAfter("192.0.2.2") != 0 {
		t.Fatal("another IP was blocked")
	}
	now = now.Add(time.Minute - time.Millisecond)
	if l.retryAfter("192.0.2.1") != 1 {
		t.Fatal("Retry-After must round up")
	}
	now = now.Add(time.Millisecond)
	if l.retryAfter("192.0.2.1") != 0 {
		t.Fatal("window did not expire")
	}
	if newIPLimiter(1).retryAfter("192.0.2.1") != 0 {
		t.Fatal("restart must reset state")
	}
}

func TestIPLimiterCapacity(t *testing.T) {
	now := time.Unix(1000, 0)
	l := newIPLimiter(1)
	l.capacity = 2
	l.now = func() time.Time { return now }
	l.retryAfter("192.0.2.1")
	l.retryAfter("192.0.2.2")
	if l.retryAfter("192.0.2.3") != 60 || len(l.entries) != 2 {
		t.Fatal("capacity is not bounded")
	}
	now = now.Add(time.Minute)
	if l.retryAfter("192.0.2.3") != 0 || len(l.entries) != 1 {
		t.Fatal("expired keys were not reclaimed")
	}
}

func TestIPLimiterConcurrent(t *testing.T) {
	l := newIPLimiter(7)
	var allowed atomic.Int32
	var group sync.WaitGroup
	for range 100 {
		group.Go(func() {
			if l.retryAfter("2001:db8::1") == 0 {
				allowed.Add(1)
			}
		})
	}
	group.Wait()
	if allowed.Load() != 7 {
		t.Fatalf("allowed %d instead of 7", allowed.Load())
	}
}
