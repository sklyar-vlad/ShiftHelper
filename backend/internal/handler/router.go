package handler

import (
	"crypto/rand"
	"io"
	"net/http"
	"regexp"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/metrics"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/status"
	"go.uber.org/zap"
)

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

func NewRouter(logger *zap.Logger, pool *pgxpool.Pool, metricsToken string) *gin.Engine {
	router := gin.New()
	router.HandleMethodNotAllowed = true
	router.Use(func(c *gin.Context) {
		id := c.GetHeader("X-Request-Id")
		if !requestIDPattern.MatchString(id) {
			id = rand.Text()
		}
		c.Header("X-Request-Id", id)
		started := time.Now()
		c.Next()
		logger.Info("http request", zap.String("method", c.Request.Method), zap.String("route", c.FullPath()), zap.Int("status", c.Writer.Status()), zap.Duration("duration", time.Since(started)), zap.String("requestId", id))
	}, metrics.Observe, gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, _ any) {
		logger.Error("http panic recovered")
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_ERROR", "message": "Внутренняя ошибка сервера."}})
	}))
	status.NewHandler(status.NewService(status.NewRepository(pool))).Register(router)
	router.GET("/metrics", gin.WrapH(metrics.Handler(metricsToken)))
	router.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "NOT_FOUND", "message": "Ресурс не найден."}})
	})
	return router
}
