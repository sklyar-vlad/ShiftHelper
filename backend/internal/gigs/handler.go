package gigs

import (
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
	ID        string           `json:"id"`
	GigID     string           `json:"gigId"`
	Worker    users.PublicUser `json:"worker"`
	Comment   string           `json:"comment"`
	Status    string           `json:"status"`
	CreatedAt time.Time        `json:"createdAt"`
	UpdatedAt time.Time        `json:"updatedAt"`
}

type Gig struct {
	ID                       string            `json:"id"`
	Title                    string            `json:"title"`
	Description              string            `json:"description"`
	Requirements             string            `json:"requirements"`
	City                     string            `json:"city"`
	Address                  string            `json:"address"`
	StartsAt                 time.Time         `json:"startsAt"`
	EndsAt                   time.Time         `json:"endsAt"`
	AmountKopecks            int64             `json:"amountKopecks"`
	Status                   string            `json:"status"`
	Customer                 users.PublicUser  `json:"customer"`
	SelectedWorker           *users.PublicUser `json:"selectedWorker"`
	PendingApplicationsCount int64             `json:"pendingApplicationsCount"`
	CreatedAt                time.Time         `json:"createdAt"`
	UpdatedAt                time.Time         `json:"updatedAt"`
	SubmittedAt              *time.Time        `json:"submittedAt"`
	CompletedAt              *time.Time        `json:"completedAt"`
	CancelledAt              *time.Time        `json:"cancelledAt"`
	MyApplication            *Application      `json:"myApplication"`
}

type Handler struct{ pool *pgxpool.Pool }

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

func (h *Handler) Register(api *gin.RouterGroup, requireUser gin.HandlerFunc) {
	api.POST("/gigs", requireUser, auth.RequireRole("customer"), h.create)
	api.POST("/gigs/:gigId/cancel", requireUser, auth.RequireRole("customer"), h.cancel)
}

var datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`)

func (h *Handler) create(c *gin.Context) {
	var input struct {
		Title         string  `json:"title"`
		Description   string  `json:"description"`
		Requirements  *string `json:"requirements"`
		City          string  `json:"city"`
		Address       string  `json:"address"`
		StartsAt      string  `json:"startsAt"`
		EndsAt        string  `json:"endsAt"`
		AmountKopecks *int64  `json:"amountKopecks"`
	}
	if !httpapi.DecodeJSON(c, &input, 128*1024) {
		return
	}
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
	if startErr != nil || !datePattern.MatchString(input.StartsAt) || !startsAt.After(time.Now()) {
		fields["startsAt"] = []string{"Укажите будущую дату с часовым поясом."}
	}
	if endErr != nil || !datePattern.MatchString(input.EndsAt) || !endsAt.After(startsAt) {
		fields["endsAt"] = []string{"Окончание должно быть позже начала; укажите часовой пояс."}
	}
	if input.AmountKopecks == nil || *input.AmountKopecks < 1 || *input.AmountKopecks > 10000000000 {
		fields["amountKopecks"] = []string{"Укажите сумму от 1 до 10000000000 целых копеек."}
	}
	if httpapi.ValidationError(c, fields) {
		return
	}
	gig, err := scanGig(h.pool.QueryRow(c.Request.Context(), `INSERT INTO gigs
        (customer_id, title, description, requirements, city, address, starts_at, ends_at, amount_kopecks)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+gigColumns,
		auth.UserFromContext(c).ID, input.Title, input.Description, *input.Requirements, input.City,
		input.Address, startsAt, endsAt, *input.AmountKopecks), auth.UserFromContext(c))
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	c.JSON(http.StatusCreated, gig)
}

const gigColumns = `id::text, title, description, requirements, city, address, starts_at, ends_at,
    amount_kopecks, status, created_at, updated_at, submitted_at, completed_at, cancelled_at`

func scanGig(row pgx.Row, customer *auth.User) (Gig, error) {
	var gig Gig
	err := row.Scan(&gig.ID, &gig.Title, &gig.Description, &gig.Requirements, &gig.City, &gig.Address,
		&gig.StartsAt, &gig.EndsAt, &gig.AmountKopecks, &gig.Status, &gig.CreatedAt, &gig.UpdatedAt,
		&gig.SubmittedAt, &gig.CompletedAt, &gig.CancelledAt)
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
