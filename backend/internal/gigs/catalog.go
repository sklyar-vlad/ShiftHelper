package gigs

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

type GigPage struct {
	Items    []GigSummary `json:"items"`
	Page     int          `json:"page"`
	PageSize int          `json:"pageSize"`
	Total    int64        `json:"total"`
}

const profilesSQL = `WITH profiles AS NOT MATERIALIZED (
    SELECT u.id, u.name, u.bio, u.role,
        (SELECT count(*) FROM gigs done WHERE done.status = 'completed'
         AND ((u.role = 'customer' AND done.customer_id = u.id)
           OR (u.role = 'worker' AND done.selected_worker_id = u.id))) AS "completedGigsCount"
    FROM users u
)`

const summaryJSON = `jsonb_build_object(
    'id', g.id, 'title', g.title, 'city', g.city, 'startsAt', g.starts_at, 'endsAt', g.ends_at,
    'amountKopecks', g.amount_kopecks, 'status', g.status, 'createdAt', g.created_at, 'updatedAt', g.updated_at,
    'customer', to_jsonb(customer),
    'selectedWorker', CASE WHEN worker.id IS NULL THEN NULL ELSE to_jsonb(worker) END,
    'pendingApplicationsCount', (SELECT count(*) FROM applications a WHERE a.gig_id = g.id AND a.status = 'pending')
)`

const profileJoins = `JOIN profiles customer ON customer.id = g.customer_id
    LEFT JOIN profiles worker ON worker.id = g.selected_worker_id`

func (h *Handler) list(c *gin.Context) {
	query := c.Request.URL.Query()
	page, pageSize, fields := httpapi.Pagination(c)
	search, city := strings.TrimSpace(query.Get("q")), strings.TrimSpace(query.Get("city"))
	if utf8.RuneCountInString(search) > 150 {
		fields["q"] = []string{"Поиск должен содержать не больше 150 символов."}
	}
	if utf8.RuneCountInString(city) > 100 {
		fields["city"] = []string{"Город должен содержать не больше 100 символов."}
	}
	if httpapi.ValidationError(c, fields) {
		return
	}
	result := GigPage{Page: int(page), PageSize: int(pageSize)}
	err := h.pool.QueryRow(c.Request.Context(), profilesSQL+`, filtered AS (
        SELECT * FROM gigs WHERE status = 'open'
          AND ($1 = '' OR strpos(lower(title), lower($1)) > 0)
          AND ($2 = '' OR lower(city) = lower($2))
    )
    SELECT COALESCE(jsonb_agg(page.item ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb),
           (SELECT count(*) FROM filtered)
    FROM (SELECT `+summaryJSON+` AS item, g.created_at, g.id FROM filtered g `+profileJoins+`
          ORDER BY g.created_at DESC, g.id DESC LIMIT $3 OFFSET $4) page`,
		search, city, pageSize, (page-1)*pageSize).Scan(&result.Items, &result.Total)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) get(c *gin.Context) {
	id := c.Param("gigId")
	if !httpapi.ValidUUID(id) {
		httpapi.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Некорректный идентификатор задания.")
		return
	}
	var viewer any
	if user := auth.UserFromContext(c); user != nil {
		viewer = user.ID
	}
	var gig Gig
	err := h.pool.QueryRow(c.Request.Context(), profilesSQL+` SELECT `+summaryJSON+` || jsonb_build_object(
        'description', g.description, 'requirements', g.requirements, 'address', g.address,
        'submittedAt', g.submitted_at, 'completedAt', g.completed_at, 'cancelledAt', g.cancelled_at,
        'myApplication', (SELECT `+applicationJSON+`
            FROM applications a JOIN profiles applicant ON applicant.id = a.worker_id
            WHERE a.gig_id = g.id AND a.worker_id = $2::uuid))
        FROM gigs g `+profileJoins+` WHERE g.id = $1 AND (g.status = 'open' OR g.customer_id = $2::uuid
          OR g.selected_worker_id = $2::uuid
          OR EXISTS (SELECT 1 FROM applications a WHERE a.gig_id = g.id AND a.worker_id = $2::uuid))`,
		id, viewer).Scan(&gig)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Задание не найдено.")
	} else if err != nil {
		httpapi.InternalError(c)
	} else {
		c.JSON(http.StatusOK, gig)
	}
}
