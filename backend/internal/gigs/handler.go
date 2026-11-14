package gigs

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/users"
)

type Application struct {
	TermsVersion int              `json:"termsVersion"`
	ID           string           `json:"id"`
	GigID        string           `json:"gigId"`
	Worker       users.PublicUser `json:"worker"`
	Comment      string           `json:"comment"`
	Status       string           `json:"status"`
	CreatedAt    time.Time        `json:"createdAt"`
	UpdatedAt    time.Time        `json:"updatedAt"`
}

type GigSummary struct {
	Category                 string            `json:"category"`
	TermsVersion             int               `json:"termsVersion"`
	HasPendingChange         bool              `json:"hasPendingChange"`
	ID                       string            `json:"id"`
	Title                    string            `json:"title"`
	City                     string            `json:"city"`
	StartsAt                 time.Time         `json:"startsAt"`
	EndsAt                   time.Time         `json:"endsAt"`
	AmountKopecks            int64             `json:"amountKopecks"`
	Status                   string            `json:"status"`
	Customer                 users.PublicUser  `json:"customer"`
	SelectedWorker           *users.PublicUser `json:"selectedWorker"`
	PendingApplicationsCount int64             `json:"pendingApplicationsCount"`
	CreatedAt                time.Time         `json:"createdAt"`
	UpdatedAt                time.Time         `json:"updatedAt"`
}

type Gig struct {
	PendingChange       *TermsChange `json:"pendingChange,omitempty"`
	CounterpartyContact *string      `json:"counterpartyContact,omitempty"`
	GigSummary
	Description   string       `json:"description"`
	Requirements  string       `json:"requirements"`
	Address       string       `json:"address"`
	SubmittedAt   *time.Time   `json:"submittedAt"`
	CompletedAt   *time.Time   `json:"completedAt"`
	CancelledAt   *time.Time   `json:"cancelledAt"`
	MyApplication *Application `json:"myApplication"`
}

type Handler struct{ pool *pgxpool.Pool }

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

func (h *Handler) Register(api *gin.RouterGroup, requireUser, optionalUser gin.HandlerFunc) {
	api.GET("/gig-categories", httpapi.ValidateQuery(), h.categories)
	api.GET("/me/gigs", httpapi.ValidateQuery("page", "pageSize", "scope"), requireUser, h.myGigs)
	api.GET("/me/applications", httpapi.ValidateQuery("page", "pageSize", "scope"), requireUser, auth.RequireRole("worker"), h.myApplications)
	api.GET("/gigs", httpapi.ValidateQuery("page", "pageSize", "q", "city"), h.list)
	api.GET("/gigs/:gigId", httpapi.ValidateQuery(), optionalUser, h.get)
	api.GET("/gigs/:gigId/applications", httpapi.ValidateQuery("page", "pageSize", "status"), requireUser, auth.RequireRole("customer"), h.listApplications)
	write := api.Group("", httpapi.ValidateQuery())
	write.POST("/gigs", requireUser, auth.RequireRole("customer"), h.create)
	write.PUT("/gigs/:gigId/terms", requireUser, auth.RequireRole("customer"), h.editTerms)
	write.POST("/gigs/:gigId/applications/:applicationId/confirm-terms", requireUser, auth.RequireRole("worker"), h.confirmTerms)
	for _, action := range []string{"accept", "reject", "withdraw"} {
		write.POST("/gigs/:gigId/changes/:changeId/"+action, requireUser, func(c *gin.Context) { h.resolveChange(c, action) })
	}
	write.POST("/gigs/:gigId/cancel", requireUser, auth.RequireRole("customer"), h.cancel)
	write.POST("/gigs/:gigId/submit", requireUser, auth.RequireRole("worker"), func(c *gin.Context) { h.finish(c, false) })
	write.POST("/gigs/:gigId/confirm", requireUser, auth.RequireRole("customer"), func(c *gin.Context) { h.finish(c, true) })
	write.POST("/gigs/:gigId/applications", requireUser, auth.RequireRole("worker"), h.apply)
	write.POST("/gigs/:gigId/applications/:applicationId/select", requireUser, auth.RequireRole("customer"), h.selectWorker)
	write.POST("/gigs/:gigId/applications/:applicationId/withdraw", requireUser, auth.RequireRole("worker"), h.withdraw)
}

var datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`)

func (h *Handler) create(c *gin.Context) {
	var input termsInput
	if !httpapi.DecodeJSON(c, &input, 128*1024) {
		return
	}
	startsAt, endsAt, valid := input.validate(c, nil)
	if !valid {
		return
	}
	if !resolveCategory(c, h.pool, &input, "other") {
		return
	}
	gig, err := scanGig(h.pool.QueryRow(c.Request.Context(), `INSERT INTO gigs
        (customer_id, title, description, requirements, city, address, starts_at, ends_at, amount_kopecks, category)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,($10::jsonb #>> '{}')) RETURNING `+gigColumns,
		auth.UserFromContext(c).ID, input.Title, input.Description, *input.Requirements, input.City,
		input.Address, startsAt, endsAt, *input.AmountKopecks, input.Category), auth.UserFromContext(c))
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	c.JSON(http.StatusCreated, gig)
}

const gigColumns = `id::text, title, description, requirements, city, address, starts_at, ends_at,
    amount_kopecks, status, created_at, updated_at, submitted_at, completed_at, cancelled_at, terms_version, category`

func scanGig(row pgx.Row, customer *auth.User) (Gig, error) {
	var gig Gig
	err := row.Scan(&gig.ID, &gig.Title, &gig.Description, &gig.Requirements, &gig.City, &gig.Address,
		&gig.StartsAt, &gig.EndsAt, &gig.AmountKopecks, &gig.Status, &gig.CreatedAt, &gig.UpdatedAt,
		&gig.SubmittedAt, &gig.CompletedAt, &gig.CancelledAt, &gig.TermsVersion, &gig.Category)
	gig.Customer = users.PublicUser{ID: customer.ID, Name: customer.Name, Bio: customer.Bio,
		Role: customer.Role, CompletedGigsCount: customer.CompletedGigsCount}
	for _, stamp := range []*time.Time{&gig.StartsAt, &gig.EndsAt, &gig.CreatedAt, &gig.UpdatedAt,
		gig.SubmittedAt, gig.CompletedAt, gig.CancelledAt} {
		if stamp != nil {
			*stamp = stamp.UTC()
		}
	}
	return gig, err
}

func (h *Handler) cancel(c *gin.Context) {
	id := c.Param("gigId")
	if !httpapi.ValidUUID(id) {
		httpapi.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Некорректный идентификатор задания.")
		return
	}
	ctx := c.Request.Context()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var owner, status string
	err = tx.QueryRow(ctx, "SELECT customer_id::text, status FROM gigs WHERE id = $1 FOR UPDATE", id).Scan(&owner, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Задание не найдено.")
		return
	}
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	if owner != auth.UserFromContext(c).ID {
		if status == "open" {
			httpapi.Fail(c, http.StatusForbidden, "FORBIDDEN", "Отменить задание может только его автор.")
		} else {
			httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Задание не найдено.")
		}
		return
	}
	if status != "open" {
		httpapi.Fail(c, http.StatusConflict, "STATE_CONFLICT", "Можно отменить только открытое задание.")
		return
	}
	if _, err := tx.Exec(ctx, "UPDATE applications SET status = 'rejected', updated_at = now() WHERE gig_id = $1 AND status = 'pending'", id); err != nil {
		httpapi.InternalError(c)
		return
	}
	gig, err := scanGig(tx.QueryRow(ctx, "UPDATE gigs SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1 RETURNING "+gigColumns, id), auth.UserFromContext(c))
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpapi.InternalError(c)
		return
	}
	c.JSON(http.StatusOK, gig)
}

type termsInput struct {
	Category      json.RawMessage `json:"category,omitempty"`
	Title         string          `json:"title"`
	Description   string          `json:"description"`
	Requirements  *string         `json:"requirements"`
	City          string          `json:"city"`
	Address       string          `json:"address"`
	StartsAt      string          `json:"startsAt"`
	EndsAt        string          `json:"endsAt"`
	AmountKopecks *int64          `json:"amountKopecks"`
}

func (input *termsInput) validate(c *gin.Context, previousStart *time.Time) (time.Time, time.Time, bool) {
	fields := make(map[string][]string)
	for _, field := range []struct {
		name     string
		value    *string
		min, max int
	}{
		{"title", &input.Title, 1, 150}, {"description", &input.Description, 1, 5000},
		{"requirements", input.Requirements, 0, 2000}, {"city", &input.City, 1, 100}, {"address", &input.Address, 1, 300},
	} {
		if field.value == nil {
			fields[field.name] = []string{"Обязательное поле."}
			continue
		}
		*field.value = strings.TrimSpace(*field.value)
		length := utf8.RuneCountInString(*field.value)
		if length < field.min || length > field.max || strings.ContainsRune(*field.value, 0) {
			fields[field.name] = []string{"Проверьте значение и длину поля."}
		}
	}
	startsAt, startErr := time.Parse(time.RFC3339Nano, input.StartsAt)
	endsAt, endErr := time.Parse(time.RFC3339Nano, input.EndsAt)
	if startErr != nil || !datePattern.MatchString(input.StartsAt) || (!startsAt.After(time.Now()) && (previousStart == nil || !startsAt.Equal(*previousStart))) {
		fields["startsAt"] = []string{"Укажите будущую дату с часовым поясом."}
	}
	if endErr != nil || !datePattern.MatchString(input.EndsAt) || !endsAt.After(startsAt) {
		fields["endsAt"] = []string{"Окончание должно быть позже начала; укажите часовой пояс."}
	}
	if input.AmountKopecks == nil || *input.AmountKopecks < 1 || *input.AmountKopecks > 10000000000 {
		fields["amountKopecks"] = []string{"Укажите сумму от 1 до 10000000000 целых копеек."}
	}
	if httpapi.ValidationError(c, fields) {
		return startsAt, endsAt, false
	}
	return startsAt, endsAt, true
}
