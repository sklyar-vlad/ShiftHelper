package handler

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func TestAuthLimitsAndProxyTrust(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	for _, trusted := range []bool{false, true} {
		t.Run(fmt.Sprint(trusted), func(t *testing.T) {
			router := NewRouter(zap.NewNop(), nil, "", "http://shifthelper.localhost")
			if trusted {
				if err := router.SetTrustedProxies([]string{"10.0.0.1"}); err != nil {
					t.Fatal(err)
				}
			}
			send := func(path, peer, forwarded, body string) *httptest.ResponseRecorder {
				req := httptest.NewRequest("POST", path, strings.NewReader(body))
				req.RemoteAddr = peer
				req.Header.Set("Origin", "http://shifthelper.localhost")
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("X-Forwarded-For", forwarded)
				req.Header.Set("X-Real-IP", forwarded)
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
				return rec
			}
			peer := "198.51.100.1:1234"
			if trusted {
				peer = "10.0.0.1:1234"
			}
			for i := range 30 {
				xff := fmt.Sprintf("203.0.113.%d", i+1)
				if trusted {
					xff += ", 198.51.100.1"
				}
				if r := send("/api/v1/auth/login", peer, xff, "{}"); r.Code != 400 {
					t.Fatalf("attempt %d: %d", i, r.Code)
				}
			}
			xff := "203.0.113.200"
			if trusted {
				xff += ", 198.51.100.1"
			}
			r := send("/api/v1/auth/login", peer, xff, `{"email":"valid@example.test","password":"password123"}`)
			if r.Code != 429 || r.Header().Get("Retry-After") != "60" || !strings.Contains(r.Body.String(), "RATE_LIMITED") {
				t.Fatalf("limiter must reject before reaching nil database: %d", r.Code)
			}
			otherPeer, otherXFF := "198.51.100.2:1234", "203.0.113.201"
			if trusted {
				otherPeer, otherXFF = peer, "198.51.100.2"
			}
			if send("/api/v1/auth/login", otherPeer, otherXFF, "{}").Code != 400 {
				t.Fatal("another client was blocked")
			}
			for range 20 {
				if send("/api/v1/auth/register", peer, xff, "{}").Code != 400 {
					t.Fatal("registration budget must be separate")
				}
			}
			if send("/api/v1/auth/register", peer, xff, "{}").Code != 429 {
				t.Fatal("registration limit not enforced")
			}
			if send("/api/v1/auth/logout", peer, xff, "").Code != 204 {
				t.Fatal("logout must not be limited")
			}
		})
	}
}
