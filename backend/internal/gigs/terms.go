package gigs

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

type TermsChange struct {
	ID           string     `json:"id"`
	TermsVersion int        `json:"termsVersion"`
	Terms        termsInput `json:"terms"`
}

type lockedTerms struct {
	owner, worker, status string
	version               int
	startsAt              time.Time
}

func lockTerms(c *gin.Context, tx pgx.Tx, id string) (lockedTerms, bool) {
	var state lockedTerms
	err := tx.QueryRow(c.Request.Context(), `SELECT customer_id::text, COALESCE(selected_worker_id::text,''), status, terms_version, starts_at FROM gigs WHERE id=$1 FOR UPDATE`, id).Scan(&state.owner, &state.worker, &state.status, &state.version, &state.startsAt)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, 404, "NOT_FOUND", "Задание не найдено.")
		return state, false
	}
	if err != nil {
		httpapi.InternalError(c)
		return state, false
	}
	return state, true
}
func termsConflict(c *gin.Context) {
	httpapi.Fail(c, 409, "STATE_CONFLICT", "Условия задания или предложение изменились. Обновите задание и проверьте актуальные условия.")
}

func saveTerms(c *gin.Context, tx pgx.Tx, id string, input termsInput) bool {
	_, err := tx.Exec(c.Request.Context(), `UPDATE gigs SET title=$2,description=$3,requirements=$4,city=$5,address=$6,starts_at=$7::timestamptz,ends_at=$8::timestamptz,amount_kopecks=$9,terms_version=terms_version+1,updated_at=clock_timestamp() WHERE id=$1`, id, input.Title, input.Description, *input.Requirements, input.City, input.Address, input.StartsAt, input.EndsAt, *input.AmountKopecks)
	if err != nil {
		httpapi.InternalError(c)
		return false
	}
	return true
}
func respondTerms(c *gin.Context, tx pgx.Tx, id string) {
	var gig Gig
	if err := tx.QueryRow(c.Request.Context(), detailSQL+" WHERE g.id=$1", id, auth.UserFromContext(c).ID).Scan(&gig); err != nil {
		httpapi.InternalError(c)
		return
	}
	if err := tx.Commit(c.Request.Context()); err != nil {
		httpapi.InternalError(c)
		return
	}
	c.JSON(http.StatusOK, gig)
}

func (h *Handler) editTerms(c *gin.Context) {
	id := c.Param("gigId")
	if !httpapi.ValidUUID(id) {
		httpapi.Fail(c, 400, "VALIDATION_ERROR", "Некорректный идентификатор задания.")
		return
	}
	var input struct {
		termsInput
		TermsVersion int `json:"termsVersion"`
	}
	if !httpapi.DecodeJSON(c, &input, 128*1024) {
		return
	}
	ctx := c.Request.Context()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	state, ok := lockTerms(c, tx, id)
	if !ok {
		return
	}
	if state.owner != auth.UserFromContext(c).ID {
		if state.status == "open" {
			httpapi.Fail(c, 403, "FORBIDDEN", "Изменить условия может только автор задания.")
		} else {
			httpapi.Fail(c, 404, "NOT_FOUND", "Задание не найдено.")
		}
		return
	}
	if (state.status != "open" && state.status != "in_progress") || state.version != input.TermsVersion {
		termsConflict(c)
		return
	}
	if _, _, valid := input.validate(c, &state.startsAt); !valid {
		return
	}
	if state.status == "open" {
		if !saveTerms(c, tx, id, input.termsInput) {
			return
		}
	} else {
		var pending bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM gig_changes WHERE gig_id=$1 AND status='pending')", id).Scan(&pending); err != nil {
			httpapi.InternalError(c)
			return
		}
		if pending {
			termsConflict(c)
			return
		}
		data, err := json.Marshal(input.termsInput)
		if err != nil {
			httpapi.InternalError(c)
			return
		}
		if _, err := tx.Exec(ctx, "INSERT INTO gig_changes(gig_id,base_version,terms) VALUES($1,$2,$3)", id, state.version, json.RawMessage(data)); err != nil {
			httpapi.InternalError(c)
			return
		}
	}
	respondTerms(c, tx, id)
}

func (h *Handler) confirmTerms(c *gin.Context) {
	id, applicationID := c.Param("gigId"), c.Param("applicationId")
	if !httpapi.ValidUUID(id) || !httpapi.ValidUUID(applicationID) {
		httpapi.Fail(c, 400, "VALIDATION_ERROR", "Некорректный идентификатор.")
		return
	}
	var input struct {
		TermsVersion int `json:"termsVersion"`
	}
	if !httpapi.DecodeJSON(c, &input, 4096) {
		return
	}
	ctx := c.Request.Context()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	state, ok := lockTerms(c, tx, id)
	if !ok {
		return
	}
	var status string
	var version int
	err = tx.QueryRow(ctx, "SELECT status, terms_version FROM applications WHERE id=$1 AND gig_id=$2 AND worker_id=$3 FOR UPDATE", applicationID, id, auth.UserFromContext(c).ID).Scan(&status, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, 404, "NOT_FOUND", "Отклик не найден.")
		return
	}
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	if state.status != "open" || status != "pending" || state.version != input.TermsVersion || version == state.version {
		termsConflict(c)
		return
	}
	if _, err := tx.Exec(ctx, "UPDATE applications SET terms_version=$2,updated_at=clock_timestamp() WHERE id=$1", applicationID, state.version); err != nil {
		httpapi.InternalError(c)
		return
	}
	respondTerms(c, tx, id)
}

func (h *Handler) resolveChange(c *gin.Context, action string) {
	id, changeID := c.Param("gigId"), c.Param("changeId")
	if !httpapi.ValidUUID(id) || !httpapi.ValidUUID(changeID) {
		httpapi.Fail(c, 400, "VALIDATION_ERROR", "Некорректный идентификатор.")
		return
	}
	ctx := c.Request.Context()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	state, ok := lockTerms(c, tx, id)
	if !ok {
		return
	}
	userID := auth.UserFromContext(c).ID
	actor := state.worker
	if action == "withdraw" {
		actor = state.owner
	}
	if actor != userID {
		if state.owner == userID || state.worker == userID || state.status == "open" {
			httpapi.Fail(c, 403, "FORBIDDEN", "Решение доступно только выбранному исполнителю, отзыв — автору задания.")
		} else {
			httpapi.Fail(c, 404, "NOT_FOUND", "Предложение не найдено.")
		}
		return
	}
	var change TermsChange
	var status string
	err = tx.QueryRow(ctx, "SELECT base_version,terms,status FROM gig_changes WHERE id=$1 AND gig_id=$2", changeID, id).Scan(&change.TermsVersion, &change.Terms, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, 404, "NOT_FOUND", "Предложение не найдено.")
		return
	}
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	if state.status != "in_progress" || status != "pending" || change.TermsVersion != state.version {
		termsConflict(c)
		return
	}
	outcome := "rejected"
	if action == "withdraw" {
		outcome = "withdrawn"
	}
	if action == "accept" {
		if _, _, valid := change.Terms.validate(c, &state.startsAt); !valid {
			return
		}
		if !saveTerms(c, tx, id, change.Terms) {
			return
		}
		outcome = "accepted"
		if _, err := tx.Exec(ctx, "UPDATE applications SET terms_version=$3,updated_at=clock_timestamp() WHERE gig_id=$1 AND worker_id=$2", id, state.worker, state.version+1); err != nil {
			httpapi.InternalError(c)
			return
		}
	}
	if _, err := tx.Exec(ctx, "UPDATE gig_changes SET status=$2 WHERE id=$1", changeID, outcome); err != nil {
		httpapi.InternalError(c)
		return
	}
	respondTerms(c, tx, id)
}
