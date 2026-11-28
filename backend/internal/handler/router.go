package handler

import (
	"crypto/rand"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/gigs"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/metrics"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/notifications"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/reviews"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/status"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/users"
	"go.uber.org/zap"
)

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

func NewRouter(logger *zap.Logger, pool *pgxpool.Pool, metricsToken, appOrigin string) *gin.Engine {
	router := gin.New()
	_ = router.SetTrustedProxies(nil)
	router.RemoteIPHeaders = []string{"X-Forwarded-For"}
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
	authHandler := auth.NewHandler(pool, appOrigin)
	api := authHandler.Register(router)
	users.NewHandler(pool).Register(api, authHandler.RequireUser())
	gigs.NewHandler(pool).Register(api, authHandler.RequireUser(), authHandler.OptionalUser())
	geoapifyKey := strings.TrimSpace(os.Getenv("GEOAPIFY_GEOCODING_KEY"))
	findPlace, suggestPlace := gigs.NewPlaceSearch(geoapifyKey)
	place := api.Group("", httpapi.ValidateQuery(), authHandler.RequireUser(), auth.RequireRole("customer"))
	place.POST("/gig-place-search", auth.LimitByIP(8), findPlace)
	if geoapifyKey == "" {
		place.POST("/gig-place-suggestions", suggestPlace)
	} else {
		place.POST("/gig-place-suggestions", auth.LimitByIP(45), suggestPlace)
	}
	reviews.NewHandler(pool).Register(api, authHandler.RequireUser())
	notifications.NewHandler(pool).Register(api, authHandler.RequireUser())
	router.GET("/metrics", gin.WrapH(metrics.Handler(metricsToken)))
	router.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "NOT_FOUND", "message": "Ресурс не найден."}})
	})
	return router
}
