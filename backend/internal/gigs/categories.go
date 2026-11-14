package gigs

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

type Category struct {
	Code string `json:"code"`
	Name string `json:"name"`
}
type categoryReader interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (h *Handler) categories(c *gin.Context) {
	var items []Category
	err := h.pool.QueryRow(c.Request.Context(), `SELECT jsonb_agg(jsonb_build_object('code',code,'name',name) ORDER BY position) FROM gig_categories`).Scan(&items)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	c.JSON(http.StatusOK, items)
}

func resolveCategory(c *gin.Context, db categoryReader, input *termsInput, fallback string) bool {
	category := fallback
	if input.Category != nil {
		var value *string
		if json.Unmarshal(input.Category, &value) != nil || value == nil {
			httpapi.ValidationError(c, map[string][]string{"category": {"Выберите категорию из справочника."}})
			return false
		}
		category = *value
	}
	var exists bool
	if err := db.QueryRow(c.Request.Context(), "SELECT EXISTS(SELECT 1 FROM gig_categories WHERE code=$1)", category).Scan(&exists); err != nil {
		httpapi.InternalError(c)
		return false
	}
	if !exists {
		httpapi.ValidationError(c, map[string][]string{"category": {"Выберите категорию из справочника."}})
		return false
	}
	input.Category, _ = json.Marshal(category)
	return true
}
