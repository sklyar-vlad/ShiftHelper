package notifications

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

type Event struct {
	Key                string
	Type               string
	GigID              string
	GigTitle           string
	CancellationReason string
}

func Record(ctx context.Context, tx pgx.Tx, event Event, recipients ...string) error {
	if len(recipients) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO notifications (recipient_id, event_key, type, gig_id, gig_title, cancellation_reason)
		SELECT recipient::uuid, $2, $3, $4, $5, NULLIF($6, '') FROM unnest($1::text[]) AS recipient
		ON CONFLICT (recipient_id, event_key) DO NOTHING`,
		recipients, event.Type+":"+event.Key, event.Type, event.GigID, event.GigTitle, event.CancellationReason)
	return err
}

type Notification struct {
	CancellationReason *string    `json:"cancellationReason,omitempty"`
	ID                 string     `json:"id"`
	Type               string     `json:"type"`
	GigID              *string    `json:"gigId"`
	GigTitle           string     `json:"gigTitle"`
	CreatedAt          time.Time  `json:"createdAt"`
	ReadAt             *time.Time `json:"readAt"`
}

type Page struct {
	Items       []Notification `json:"items"`
	UnreadCount int64          `json:"unreadCount"`
	NextCursor  *string        `json:"nextCursor"`
}

type Handler struct{ pool *pgxpool.Pool }

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

func (h *Handler) Register(api *gin.RouterGroup, requireUser gin.HandlerFunc) {
	group := api.Group("/me/notifications", requireUser)
	group.GET("", httpapi.ValidateQuery("pageSize", "cursor"), h.list)
	group.POST("/read-all", httpapi.ValidateQuery(), h.readAll)
	group.POST("/:notificationId/read", httpapi.ValidateQuery(), h.read)
}

func decodeCursor(value string) (time.Time, string, bool) {
	if len(value) > 128 {
		return time.Time{}, "", false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return time.Time{}, "", false
	}
	stamp, id, _ := strings.Cut(string(decoded), "/")
	createdAt, err := time.Parse(time.RFC3339Nano, stamp)
	return createdAt, id, err == nil && createdAt.Year() >= 1 && httpapi.ValidUUID(id)
}

func (h *Handler) list(c *gin.Context) {
	_, limit, fields := httpapi.Pagination(c)
	var before, beforeID any
	if c.Request.URL.Query().Has("cursor") {
		createdAt, id, ok := decodeCursor(c.Query("cursor"))
		if ok {
			before, beforeID = createdAt, id
		} else {
			fields["cursor"] = []string{"Некорректный курсор уведомлений."}
		}
	}
	if httpapi.ValidationError(c, fields) {
		return
	}
	var result Page
	err := h.pool.QueryRow(c.Request.Context(), `SELECT
		COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page."createdAt" DESC, page.id DESC), '[]'::jsonb),
		(SELECT count(*) FROM notifications WHERE recipient_id = $1 AND read_at IS NULL)
		FROM (SELECT id, type, gig_id AS "gigId", gig_title AS "gigTitle",
			created_at AS "createdAt", read_at AS "readAt", cancellation_reason AS "cancellationReason"
			FROM notifications
			WHERE recipient_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3::uuid))
			ORDER BY created_at DESC, id DESC LIMIT $4) page`,
		auth.UserFromContext(c).ID, before, beforeID, limit+1).Scan(&result.Items, &result.UnreadCount)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	if int64(len(result.Items)) > limit {
		result.Items = result.Items[:limit]
		last := result.Items[len(result.Items)-1]
		cursor := base64.RawURLEncoding.EncodeToString([]byte(last.CreatedAt.UTC().Format(time.RFC3339Nano) + "/" + last.ID))
		result.NextCursor = &cursor
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) read(c *gin.Context) {
	id := c.Param("notificationId")
	if !httpapi.ValidUUID(id) {
		httpapi.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Некорректный идентификатор уведомления.")
		return
	}
	result, err := h.pool.Exec(c.Request.Context(), `UPDATE notifications
		SET read_at = COALESCE(read_at, statement_timestamp()) WHERE recipient_id = $1 AND id = $2`,
		auth.UserFromContext(c).ID, id)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	if result.RowsAffected() == 0 {
		httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Уведомление не найдено.")
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) readAll(c *gin.Context) {
	_, err := h.pool.Exec(c.Request.Context(), `UPDATE notifications SET read_at = statement_timestamp()
		WHERE recipient_id = $1 AND read_at IS NULL`, auth.UserFromContext(c).ID)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	c.Status(http.StatusNoContent)
}
