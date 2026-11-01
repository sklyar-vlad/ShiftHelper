package gigs

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

func (h *Handler) finish(c *gin.Context, confirming bool) {
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
	user := auth.UserFromContext(c)
	var owner, worker, status string
	var applied bool
	err = tx.QueryRow(ctx, `SELECT customer_id::text, COALESCE(selected_worker_id::text, ''), status,
        EXISTS (SELECT 1 FROM applications WHERE gig_id = gigs.id AND worker_id = $2)
        FROM gigs WHERE id = $1 FOR UPDATE`, id, user.ID).Scan(&owner, &worker, &status, &applied)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Задание не найдено.")
		return
	}
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	actor, required := worker, "in_progress"
	update := "UPDATE gigs SET status = 'awaiting_confirmation', submitted_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1"
	if confirming {
		actor, required = owner, "awaiting_confirmation"
		update = "UPDATE gigs SET status = 'completed', completed_at = GREATEST(clock_timestamp(), submitted_at), updated_at = clock_timestamp() WHERE id = $1"
	}
	if actor != user.ID {
		if status == "open" || applied || owner == user.ID || worker == user.ID {
			httpapi.Fail(c, http.StatusForbidden, "FORBIDDEN", "Действие доступно только выбранному исполнителю или владельцу задания.")
		} else {
			httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Задание не найдено.")
		}
		return
	}
	if status != required {
		httpapi.Fail(c, http.StatusConflict, "STATE_CONFLICT", "Текущее состояние задания не допускает это действие.")
		return
	}
	if _, err := tx.Exec(ctx, update, id); err != nil {
		httpapi.InternalError(c)
		return
	}
	var gig Gig
	if err := tx.QueryRow(ctx, detailSQL+" WHERE g.id = $1", id, user.ID).Scan(&gig); err != nil {
		httpapi.InternalError(c)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpapi.InternalError(c)
		return
	}
	c.JSON(http.StatusOK, gig)
}
