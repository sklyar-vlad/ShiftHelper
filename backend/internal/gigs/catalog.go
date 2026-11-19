package gigs

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
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
    SELECT u.id, u.name, u.bio, u.role, u.specialties,
        (SELECT count(*) FROM gigs done WHERE done.status = 'completed'
         AND ((u.role = 'customer' AND done.customer_id = u.id)
           OR (u.role = 'worker' AND done.selected_worker_id = u.id))) AS "completedGigsCount",
        (SELECT avg(score)::float8 FROM reviews WHERE recipient_id = u.id) AS "ratingAverage",
        (SELECT count(*) FROM reviews WHERE recipient_id = u.id) AS "reviewsCount"
    FROM users u
)`

const summaryJSON = `jsonb_build_object(
    'category', g.category, 'termsVersion', g.terms_version, 'hasPendingChange', EXISTS (SELECT 1 FROM gig_changes change WHERE change.gig_id = g.id AND change.status = 'pending'),
 'id', g.id, 'title', g.title, 'city', g.city, 'startsAt', g.starts_at, 'endsAt', g.ends_at,
    'amountKopecks', g.amount_kopecks, 'status', g.status, 'createdAt', g.created_at, 'updatedAt', g.updated_at,
    'customer', to_jsonb(customer),
    'selectedWorker', CASE WHEN worker.id IS NULL THEN NULL ELSE to_jsonb(worker) END,
    'pendingApplicationsCount', (SELECT count(*) FROM applications a WHERE a.gig_id = g.id AND a.status = 'pending')
)`

const profileJoins = `JOIN profiles customer ON customer.id = g.customer_id
    LEFT JOIN profiles worker ON worker.id = g.selected_worker_id`

const detailSQL = profilesSQL + ` SELECT ` + summaryJSON + ` || jsonb_build_object(
    'pendingChange', CASE WHEN g.customer_id = $2::uuid OR g.selected_worker_id = $2::uuid THEN
 (SELECT jsonb_build_object('id', change.id, 'termsVersion', change.base_version, 'terms', change.terms)
 FROM gig_changes change WHERE change.gig_id = g.id AND change.status = 'pending') END,
 'counterpartyContact', CASE WHEN g.status IN ('in_progress', 'awaiting_confirmation', 'completed') THEN
 (SELECT contact FROM users WHERE id = CASE WHEN g.customer_id = $2::uuid THEN g.selected_worker_id
 WHEN g.selected_worker_id = $2::uuid THEN g.customer_id END) END,
 'description', g.description, 'requirements', g.requirements, 'address', g.address,
    'submittedAt', g.submitted_at, 'completedAt', g.completed_at, 'cancelledAt', g.cancelled_at,
    'myApplication', (SELECT ` + applicationJSON + `
        FROM applications a JOIN profiles applicant ON applicant.id = a.worker_id
        WHERE a.gig_id = g.id AND a.worker_id = $2::uuid))
    FROM gigs g ` + profileJoins

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
	category := query.Get("category")
	if category != "" {
		var exists bool
		if err := h.pool.QueryRow(c.Request.Context(), "SELECT EXISTS(SELECT 1 FROM gig_categories WHERE code=$1)", category).Scan(&exists); err != nil {
			httpapi.InternalError(c)
			return
		}
		if !exists {
			fields["category"] = []string{"Выберите категорию из справочника."}
		}
	}
	numbers := make(map[string]*int64)
	for _, name := range []string{"minAmountKopecks", "maxAmountKopecks", "maxDurationMinutes"} {
		if raw := query.Get(name); raw != "" {
			minValue, maxValue := int64(0), int64(10000000000)
			if name == "maxDurationMinutes" {
				minValue, maxValue = 1, 2147483647
			}
			value, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || value < minValue || value > maxValue {
				fields[name] = []string{"Укажите целое число в допустимом диапазоне."}
			} else {
				numbers[name] = &value
			}
		}
	}
	if minAmount, maxAmount := numbers["minAmountKopecks"], numbers["maxAmountKopecks"]; minAmount != nil && maxAmount != nil && *minAmount > *maxAmount {
		fields["maxAmountKopecks"] = []string{"Максимальная оплата должна быть не меньше минимальной."}
	}
	dates := make(map[string]*time.Time)
	for _, name := range []string{"startsFrom", "startsBefore"} {
		if raw := query.Get(name); raw != "" {
			value, err := time.Parse(time.RFC3339Nano, raw)
			if err != nil || !datePattern.MatchString(raw) || value.Year() < 1 {
				fields[name] = []string{"Укажите дату и время с часовым поясом."}
			} else {
				dates[name] = &value
			}
		}
	}
	if from, before := dates["startsFrom"], dates["startsBefore"]; from != nil && before != nil && !from.Before(*before) {
		fields["startsBefore"] = []string{"Конец периода должен быть позже начала."}
	}
	sort := query.Get("sort")
	order := "created_at DESC, id DESC"
	switch sort {
	case "", "newest":
	case "nearest":
		order = "starts_at ASC, id ASC"
	case "amount_asc":
		order = "amount_kopecks ASC, id ASC"
	case "amount_desc":
		order = "amount_kopecks DESC, id DESC"
	default:
		fields["sort"] = []string{"Выберите доступный порядок сортировки."}
	}
	if httpapi.ValidationError(c, fields) {
		return
	}
	result := GigPage{Page: int(page), PageSize: int(pageSize)}
	err := h.pool.QueryRow(c.Request.Context(), profilesSQL+`, filtered AS (
        SELECT * FROM gigs WHERE status = 'open'
          AND ($1 = '' OR strpos(lower(title), lower($1)) > 0)
          AND ($2 = '' OR lower(city) = lower($2))
          AND ($3 = '' OR category = $3)
          AND ($4::bigint IS NULL OR amount_kopecks >= $4)
          AND ($5::bigint IS NULL OR amount_kopecks <= $5)
          AND ($6::timestamptz IS NULL OR starts_at >= $6)
          AND ($7::timestamptz IS NULL OR starts_at < $7)
          AND ($8::bigint IS NULL OR extract(epoch FROM (ends_at - starts_at)) <= $8::bigint * 60)
    )
    SELECT COALESCE(jsonb_agg(page.item ORDER BY `+order+`), '[]'::jsonb),
           (SELECT count(*) FROM filtered)
    FROM (SELECT `+summaryJSON+` AS item, g.created_at, g.starts_at, g.amount_kopecks, g.id FROM filtered g `+profileJoins+`
          ORDER BY g.`+strings.ReplaceAll(order, ", ", ", g.")+` LIMIT $9 OFFSET $10) page`,
		search, city, category, numbers["minAmountKopecks"], numbers["maxAmountKopecks"],
		dates["startsFrom"], dates["startsBefore"], numbers["maxDurationMinutes"], pageSize, (page-1)*pageSize).Scan(&result.Items, &result.Total)
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
	err := h.pool.QueryRow(c.Request.Context(), detailSQL+` WHERE g.id = $1 AND (g.status = 'open' OR g.customer_id = $2::uuid
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
