package gigs

import (
	"net/http"
	"slices"

	"github.com/gin-gonic/gin"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

type MyApplication struct {
	Application Application `json:"application"`
	Gig         GigSummary  `json:"gig"`
}

type MyApplicationPage struct {
	Items    []MyApplication `json:"items"`
	Page     int             `json:"page"`
	PageSize int             `json:"pageSize"`
	Total    int64           `json:"total"`
}

func personalPagination(c *gin.Context) (page, pageSize int64, scope string, valid bool) {
	page, pageSize, fields := httpapi.Pagination(c)
	scope = "all"
	if c.Request.URL.Query().Has("scope") {
		scope = c.Query("scope")
		if !slices.Contains([]string{"all", "active", "history"}, scope) {
			fields["scope"] = []string{"Выберите all, active или history."}
		}
	}
	return page, pageSize, scope, !httpapi.ValidationError(c, fields)
}

func (h *Handler) myGigs(c *gin.Context) {
	page, pageSize, scope, valid := personalPagination(c)
	if !valid {
		return
	}
	user := auth.UserFromContext(c)
	ownerColumn := "customer_id"
	if user.Role == "worker" {
		ownerColumn = "selected_worker_id"
	}
	result := GigPage{Page: int(page), PageSize: int(pageSize)}
	err := h.pool.QueryRow(c.Request.Context(), profilesSQL+`, filtered AS (
        SELECT * FROM gigs WHERE `+ownerColumn+` = $1 AND ($2 = 'all'
          OR ($2 = 'active' AND status IN ('open', 'in_progress', 'awaiting_confirmation'))
          OR ($2 = 'history' AND status IN ('completed', 'cancelled')))
    ) SELECT COALESCE(jsonb_agg(page.item ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb),
        (SELECT count(*) FROM filtered)
    FROM (SELECT `+summaryJSON+` AS item, g.created_at, g.id FROM filtered g `+profileJoins+`
          ORDER BY g.created_at DESC, g.id DESC LIMIT $3 OFFSET $4) page`,
		user.ID, scope, pageSize, (page-1)*pageSize).Scan(&result.Items, &result.Total)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) myApplications(c *gin.Context) {
	page, pageSize, scope, valid := personalPagination(c)
	if !valid {
		return
	}
	result := MyApplicationPage{Page: int(page), PageSize: int(pageSize)}
	err := h.pool.QueryRow(c.Request.Context(), profilesSQL+`, filtered AS (
        SELECT a.* FROM applications a JOIN gigs g ON g.id = a.gig_id
        WHERE a.worker_id = $1 AND ($2 = 'all'
          OR ($2 = 'active' AND a.status IN ('pending', 'selected')
              AND g.status IN ('open', 'in_progress', 'awaiting_confirmation'))
          OR ($2 = 'history' AND (a.status IN ('rejected', 'withdrawn') OR g.status IN ('completed', 'cancelled'))))
    ) SELECT COALESCE(jsonb_agg(page.item ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb),
        (SELECT count(*) FROM filtered)
    FROM (SELECT jsonb_build_object('application', `+applicationJSON+`, 'gig', `+summaryJSON+`) AS item,
          a.created_at, a.id FROM filtered a JOIN gigs g ON g.id = a.gig_id `+profileJoins+`
          JOIN profiles applicant ON applicant.id = a.worker_id
          ORDER BY a.created_at DESC, a.id DESC LIMIT $3 OFFSET $4) page`,
		auth.UserFromContext(c).ID, scope, pageSize, (page-1)*pageSize).Scan(&result.Items, &result.Total)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	c.JSON(http.StatusOK, result)
}
