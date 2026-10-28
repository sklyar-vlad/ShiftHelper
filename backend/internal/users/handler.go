package users

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

type PublicUser struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Bio                string `json:"bio"`
	Role               string `json:"role"`
	CompletedGigsCount int64  `json:"completedGigsCount"`
}

type Handler struct{ pool *pgxpool.Pool }

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

func (h *Handler) Register(api *gin.RouterGroup, requireUser gin.HandlerFunc) {
	api.PATCH("/me", requireUser, h.update)
	api.GET("/users/:userId", h.public)
}

func (h *Handler) update(c *gin.Context) {
	var input struct {
		Name *string `json:"name"`
		Bio  *string `json:"bio"`
	}
	if !httpapi.DecodeJSON(c, &input, 16*1024) {
		return
	}
	fields := make(map[string][]string)
	if input.Name == nil {
		fields["name"] = []string{"Укажите имя."}
	} else {
		*input.Name = strings.TrimSpace(*input.Name)
		if length := utf8.RuneCountInString(*input.Name); length < 1 || length > 100 || strings.ContainsRune(*input.Name, 0) {
			fields["name"] = []string{"Имя должно содержать от 1 до 100 символов."}
		}
	}
	if input.Bio == nil {
		fields["bio"] = []string{"Укажите описание или пустую строку."}
	} else {
		*input.Bio = strings.TrimSpace(*input.Bio)
		if utf8.RuneCountInString(*input.Bio) > 1000 || strings.ContainsRune(*input.Bio, 0) {
			fields["bio"] = []string{"Описание должно содержать не больше 1000 символов."}
		}
	}
	if httpapi.ValidationError(c, fields) {
		return
	}
	user := auth.UserFromContext(c)
	err := h.pool.QueryRow(c.Request.Context(), `UPDATE users SET name = $1, bio = $2, updated_at = now()
        WHERE id = $3 RETURNING name, bio`, *input.Name, *input.Bio, user.ID).Scan(&user.Name, &user.Bio)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, http.StatusUnauthorized, "UNAUTHORIZED", "Войдите в аккаунт.")
	} else if err != nil {
		httpapi.InternalError(c)
	} else {
		c.JSON(http.StatusOK, user)
	}
}

func (h *Handler) public(c *gin.Context) {
	if !httpapi.ValidUUID(c.Param("userId")) {
		httpapi.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Некорректный идентификатор пользователя.")
		return
	}
	var user PublicUser
	err := h.pool.QueryRow(c.Request.Context(), `SELECT u.id::text, u.name, u.bio, u.role,
        (SELECT count(*) FROM gigs g WHERE g.status = 'completed'
         AND ((u.role = 'customer' AND g.customer_id = u.id) OR (u.role = 'worker' AND g.selected_worker_id = u.id)))
        FROM users u WHERE u.id = $1`, c.Param("userId")).Scan(&user.ID, &user.Name, &user.Bio, &user.Role, &user.CompletedGigsCount)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Fail(c, http.StatusNotFound, "NOT_FOUND", "Пользователь не найден.")
	} else if err != nil {
		httpapi.InternalError(c)
	} else {
		c.JSON(http.StatusOK, user)
	}
}
