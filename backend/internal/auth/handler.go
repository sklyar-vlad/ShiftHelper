package auth

import (
	"crypto/rand"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

type User struct {
	ID                 string    `json:"id"`
	Email              string    `json:"email"`
	Name               string    `json:"name"`
	Bio                string    `json:"bio"`
	Role               string    `json:"role"`
	CreatedAt          time.Time `json:"createdAt"`
	CompletedGigsCount int64     `json:"completedGigsCount"`
}

type Handler struct {
	pool      *pgxpool.Pool
	origin    string
	dummyHash string
}

func NewHandler(pool *pgxpool.Pool, origin string) *Handler {
	return &Handler{pool: pool, origin: strings.TrimSuffix(origin, "/"), dummyHash: hashPassword(rand.Text())}
}

func (h *Handler) Register(router *gin.Engine) *gin.RouterGroup {
	api := router.Group("/api/v1", h.checkOrigin)
	api.POST("/auth/register", h.register)
	api.POST("/auth/login", h.login)
	api.POST("/auth/logout", h.logout)
	api.GET("/me", h.RequireUser(), func(c *gin.Context) { c.JSON(http.StatusOK, UserFromContext(c)) })
	return api
}

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (input *credentials) validate() map[string][]string {
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	fields := make(map[string][]string)
	address, err := mail.ParseAddress(input.Email)
	if err != nil || address.Address != input.Email || utf8.RuneCountInString(input.Email) > 254 {
		fields["email"] = []string{"Укажите корректный email."}
	}
	if length := utf8.RuneCountInString(input.Password); length < 8 || length > 128 {
		fields["password"] = []string{"Пароль должен содержать от 8 до 128 символов."}
	}
	return fields
}

const userColumns = `u.id::text, u.email, u.name, u.bio, u.role, u.created_at,
    (SELECT count(*) FROM gigs g WHERE g.status = 'completed'
     AND ((u.role = 'customer' AND g.customer_id = u.id) OR (u.role = 'worker' AND g.selected_worker_id = u.id)))`

func scanUser(row pgx.Row, extra ...any) (User, error) {
	var user User
	args := []any{&user.ID, &user.Email, &user.Name, &user.Bio, &user.Role, &user.CreatedAt, &user.CompletedGigsCount}
	err := row.Scan(append(args, extra...)...)
	user.CreatedAt = user.CreatedAt.UTC()
	return user, err
}

func (h *Handler) register(c *gin.Context) {
	var input struct {
		credentials
		Name string `json:"name"`
		Role string `json:"role"`
	}
	if !httpapi.DecodeJSON(c, &input, 4096) {
		return
	}
	fields := input.validate()
	input.Name = strings.TrimSpace(input.Name)
	input.Role = strings.TrimSpace(input.Role)
	if length := utf8.RuneCountInString(input.Name); length < 1 || length > 100 {
		fields["name"] = []string{"Имя должно содержать от 1 до 100 символов."}
	}
	if input.Role != "customer" && input.Role != "worker" {
		fields["role"] = []string{"Выберите заказчика или исполнителя."}
	}
	if httpapi.ValidationError(c, fields) {
		return
	}
	passwordHash := hashPassword(input.Password)
	ctx := c.Request.Context()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	user, err := scanUser(tx.QueryRow(ctx, `INSERT INTO users (email, password_hash, role, name)
        VALUES ($1, $2, $3, $4) RETURNING id::text, email, name, bio, role, created_at, 0`,
		input.Email, passwordHash, input.Role, input.Name))
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) && pgerr.Code == "23505" {
		httpapi.Fail(c, http.StatusConflict, "EMAIL_TAKEN", "Этот email уже зарегистрирован.")
		return
	}
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	h.respondWithSession(c, tx, user, http.StatusCreated)
}

func (h *Handler) login(c *gin.Context) {
	var input credentials
	if !httpapi.DecodeJSON(c, &input, 4096) || httpapi.ValidationError(c, input.validate()) {
		return
	}
	var stored string
	user, err := scanUser(h.pool.QueryRow(c.Request.Context(),
		"SELECT "+userColumns+", u.password_hash FROM users u WHERE u.email = $1", input.Email), &stored)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		httpapi.InternalError(c)
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		stored = h.dummyHash
	}
	if !verifyPassword(input.Password, stored) || err != nil {
		httpapi.Fail(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Неверный email или пароль.")
		return
	}
	tx, err := h.pool.Begin(c.Request.Context())
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	defer func() { _ = tx.Rollback(c.Request.Context()) }()
	h.respondWithSession(c, tx, user, http.StatusOK)
}
