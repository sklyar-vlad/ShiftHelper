package status

import (
	"context"
	"github.com/gin-gonic/gin"
	"net/http"
	"time"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }
func (h *Handler) Register(router *gin.Engine) {
	router.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	router.GET("/readyz", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), time.Second)
		defer cancel()
		if err := h.service.Ready(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not_ready"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})
	router.GET("/api/v1/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"service": "ShiftHelper", "version": "0.1.0", "status": "ok"})
	})
}
