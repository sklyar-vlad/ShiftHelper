package gigs

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/users"
)

type ApplicationPage struct {
	Items    []Application `json:"items"`
	Page     int           `json:"page"`
	PageSize int           `json:"pageSize"`
	Total    int64         `json:"total"`
}

const applicationColumns = `id::text, gig_id::text, comment, status, created_at, updated_at`
const applicationJSON = `jsonb_build_object('id', a.id, 'gigId', a.gig_id, 'worker', to_jsonb(applicant),
    'comment', a.comment, 'status', a.status, 'createdAt', a.created_at, 'updatedAt', a.updated_at)`

func scanApplication(row pgx.Row, worker *auth.User) (Application, error) {
	var application Application
	err := row.Scan(&application.ID, &application.GigID, &application.Comment, &application.Status, &application.CreatedAt, &application.UpdatedAt)
	application.Worker = users.PublicUser{ID: worker.ID, Name: worker.Name, Bio: worker.Bio,
		Role: worker.Role, CompletedGigsCount: worker.CompletedGigsCount}
	application.CreatedAt = application.CreatedAt.UTC()
	application.UpdatedAt = application.UpdatedAt.UTC()
	return application, err
}

func (h *Handler) apply(c *gin.Context) {
	id := c.Param("gigId")
	if !httpapi.ValidUUID(id) {
		httpapi.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Некорректный идентификатор задания.")
		return
	}
	var input *struct {
		Comment json.RawMessage `json:"comment"`
	}
	if !httpapi.DecodeJSON(c, &input, 16*1024) {
		return
	}
	if input == nil {
		httpapi.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Ожидается JSON-объект.")
		return
	}
	comment := ""
	if input.Comment != nil {
		var value *string
		if json.Unmarshal(input.Comment, &value) != nil || value == nil {
			httpapi.ValidationError(c, map[string][]string{"comment": {"Укажите текст комментария или уберите поле."}})
			return
		}
		comment = strings.TrimSpace(*value)
	}
	if utf8.RuneCountInString(comment) > 1000 || strings.ContainsRune(comment, 0) {
		httpapi.ValidationError(c, map[string][]string{"comment": {"Комментарий должен содержать не больше 1000 символов."}})
		return
	}
	ctx := c.Request.Context()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var status string
	err = tx.QueryRow(ctx, "SELECT status FROM gigs WHERE id = $1 FOR UPDATE", id).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Задание не найдено.")
		return
	}
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	worker := auth.UserFromContext(c)
	var exists bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM applications WHERE gig_id = $1 AND worker_id = $2)", id, worker.ID).Scan(&exists); err != nil {
		httpapi.InternalError(c)
		return
	}
	if exists {
		httpapi.Fail(c, http.StatusConflict, "ALREADY_APPLIED", "Вы уже откликались на это задание.")
		return
	}
	if status != "open" {
		httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Задание не найдено.")
		return
	}
	application, err := scanApplication(tx.QueryRow(ctx, `INSERT INTO applications (gig_id, worker_id, comment)
        VALUES ($1, $2, $3) RETURNING `+applicationColumns, id, worker.ID, comment), worker)
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) && pgerr.Code == "23505" {
		httpapi.Fail(c, http.StatusConflict, "ALREADY_APPLIED", "Вы уже откликались на это задание.")
		return
	}
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpapi.InternalError(c)
		return
	}
	c.JSON(http.StatusCreated, application)
}

func (h *Handler) withdraw(c *gin.Context) {
	gigID, id := c.Param("gigId"), c.Param("applicationId")
	if !httpapi.ValidUUID(gigID) || !httpapi.ValidUUID(id) {
		httpapi.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Некорректный идентификатор задания или отклика.")
		return
	}
	ctx := c.Request.Context()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var gigStatus, applicationStatus string
	err = tx.QueryRow(ctx, "SELECT status FROM gigs WHERE id = $1 FOR UPDATE", gigID).Scan(&gigStatus)
	if err == nil {
		err = tx.QueryRow(ctx, `SELECT status FROM applications
            WHERE id = $1 AND gig_id = $2 AND worker_id = $3 FOR UPDATE`, id, gigID, auth.UserFromContext(c).ID).Scan(&applicationStatus)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Отклик не найден.")
		return
	}
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	if gigStatus != "open" || applicationStatus != "pending" {
		httpapi.Fail(c, http.StatusConflict, "STATE_CONFLICT", "Можно отозвать только ожидающий отклик на открытое задание.")
		return
	}
	application, err := scanApplication(tx.QueryRow(ctx, "UPDATE applications SET status = 'withdrawn', updated_at = now() WHERE id = $1 RETURNING "+applicationColumns, id), auth.UserFromContext(c))
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpapi.InternalError(c)
		return
	}
	c.JSON(http.StatusOK, application)
}

func (h *Handler) listApplications(c *gin.Context) {
	id := c.Param("gigId")
	if !httpapi.ValidUUID(id) {
		httpapi.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Некорректный идентификатор задания.")
		return
	}
	page, pageSize, fields := httpapi.Pagination(c)
	status := c.Query("status")
	if c.Request.URL.Query().Has("status") && !slices.Contains([]string{"pending", "selected", "rejected", "withdrawn"}, status) {
		fields["status"] = []string{"Укажите допустимое состояние отклика."}
	}
	if httpapi.ValidationError(c, fields) {
		return
	}
	result := ApplicationPage{Page: int(page), PageSize: int(pageSize)}
	err := h.pool.QueryRow(c.Request.Context(), profilesSQL+`, filtered AS (
        SELECT * FROM applications WHERE gig_id = $1 AND ($2 = '' OR status = $2)
    ) SELECT (SELECT COALESCE(jsonb_agg(page.item ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb)
        FROM (SELECT `+applicationJSON+` AS item, a.created_at, a.id FROM filtered a
              JOIN profiles applicant ON applicant.id = a.worker_id
              ORDER BY a.created_at DESC, a.id DESC LIMIT $3 OFFSET $4) page),
        (SELECT count(*) FROM filtered)
        FROM gigs WHERE id = $1 AND customer_id = $5`,
		id, status, pageSize, (page-1)*pageSize, auth.UserFromContext(c).ID).Scan(&result.Items, &result.Total)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Задание не найдено.")
	} else if err != nil {
		httpapi.InternalError(c)
	} else {
		c.JSON(http.StatusOK, result)
	}
}
