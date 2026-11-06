package reviews

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

type Review struct {
	ID          string    `json:"id"`
	GigID       string    `json:"gigId"`
	AuthorID    string    `json:"authorId"`
	RecipientID string    `json:"recipientId"`
	Score       int       `json:"score"`
	Comment     string    `json:"comment"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Handler struct{ pool *pgxpool.Pool }

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

func (h *Handler) Register(api *gin.RouterGroup, requireUser gin.HandlerFunc) {
	api = api.Group("", httpapi.ValidateQuery(), requireUser)
	api.GET("/gigs/:gigId/reviews", h.handle)
	api.POST("/gigs/:gigId/reviews", h.handle)
}

func (h *Handler) handle(c *gin.Context) {
	id := c.Param("gigId")
	if !httpapi.ValidUUID(id) {
		httpapi.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Некорректный идентификатор задания.")
		return
	}
	writing := c.Request.Method == http.MethodPost
	var input *struct {
		Score   int             `json:"score"`
		Comment json.RawMessage `json:"comment"`
	}
	comment := ""
	if writing {
		if !httpapi.DecodeJSON(c, &input, 16*1024) {
			return
		}
		fields := make(map[string][]string)
		if input == nil || input.Score < 1 || input.Score > 5 {
			fields["score"] = []string{"Укажите целую оценку от 1 до 5."}
		}
		if input != nil && input.Comment != nil {
			var value *string
			if json.Unmarshal(input.Comment, &value) != nil || value == nil {
				fields["comment"] = []string{"Укажите текст отзыва или уберите поле."}
			} else {
				comment = strings.TrimSpace(*value)
				if utf8.RuneCountInString(comment) > 1000 || strings.ContainsRune(comment, 0) {
					fields["comment"] = []string{"Отзыв должен содержать не больше 1000 символов."}
				}
			}
		}
		if httpapi.ValidationError(c, fields) {
			return
		}
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
	lock := ""
	if writing {
		lock = " FOR UPDATE"
	}
	err = tx.QueryRow(ctx, `SELECT customer_id::text, COALESCE(selected_worker_id::text, ''), status,
        EXISTS (SELECT 1 FROM applications WHERE gig_id = gigs.id AND worker_id = $2)
        FROM gigs WHERE id = $1`+lock, id, user.ID).Scan(&owner, &worker, &status, &applied)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Задание не найдено.")
		return
	}
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	if user.ID != owner && user.ID != worker {
		if status == "open" || applied {
			httpapi.Fail(c, http.StatusForbidden, "FORBIDDEN", "Отзывы доступны только заказчику и выбранному исполнителю.")
		} else {
			httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Задание не найдено.")
		}
		return
	}
	if !writing {
		var items []Review
		err := tx.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', id, 'gigId', gig_id, 'authorId', author_id, 'recipientId', recipient_id,
            'score', score, 'comment', comment, 'createdAt', created_at)
            ORDER BY created_at DESC, id DESC), '[]'::jsonb) FROM reviews WHERE gig_id = $1`, id).Scan(&items)
		if err != nil {
			httpapi.InternalError(c)
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
		return
	}
	if status != "completed" {
		httpapi.Fail(c, http.StatusConflict, "STATE_CONFLICT", "Оценить можно только завершённую работу.")
		return
	}
	recipient := owner
	if user.ID == owner {
		recipient = worker
	}
	var review Review
	err = tx.QueryRow(ctx, `INSERT INTO reviews (gig_id, author_id, recipient_id, score, comment)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (gig_id, author_id) DO NOTHING
        RETURNING id::text, gig_id::text, author_id::text, recipient_id::text, score, comment, created_at`,
		id, user.ID, recipient, input.Score, comment).Scan(&review.ID, &review.GigID, &review.AuthorID,
		&review.RecipientID, &review.Score, &review.Comment, &review.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, http.StatusConflict, "ALREADY_REVIEWED", "Вы уже оставили оценку за эту работу.")
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
	review.CreatedAt = review.CreatedAt.UTC()
	c.JSON(http.StatusCreated, review)
}
