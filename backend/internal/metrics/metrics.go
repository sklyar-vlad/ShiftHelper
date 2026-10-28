package metrics

import (
	"crypto/subtle"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var requests = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "shifthelper_http_requests_total", Help: "HTTP requests by method, route and status."}, []string{"method", "route", "status"})
var duration = prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "shifthelper_http_request_duration_seconds", Help: "HTTP request duration."}, []string{"method", "route"})

func init() { prometheus.MustRegister(requests, duration) }
func Observe(c *gin.Context) {
	started := time.Now()
	c.Next()
	route := c.FullPath()
	if route == "" {
		route = "unmatched"
	}
	requests.WithLabelValues(c.Request.Method, route, http.StatusText(c.Writer.Status())).Inc()
	duration.WithLabelValues(c.Request.Method, route).Observe(time.Since(started).Seconds())
}
func Handler(token string) http.Handler {
	handler := promhttp.Handler()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		handler.ServeHTTP(w, r)
	})
}
