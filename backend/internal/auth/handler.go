package auth

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
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

func (h *Handler) Register(router *gin.Engine) {
	api := router.Group("/api/v1", h.checkOrigin)
	api.POST("/auth/register", h.register)
	api.POST("/auth/login", h.login)
	api.POST("/auth/logout", h.logout)
	api.GET("/me", h.RequireUser(), func(c *gin.Context) { c.JSON(http.StatusOK, UserFromContext(c)) })
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

func decode(c *gin.Context, input any) bool {
	contentType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 4096))
	decoder.DisallowUnknownFields()
	if err != nil || contentType != "application/json" ||
		decoder.Decode(input) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Некорректный JSON или параметры запроса.")
		return false
	}
	return true
}

func validationError(c *gin.Context, fields map[string][]string) bool {
	if len(fields) == 0 {
		return false
	}
	c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": gin.H{
		"code": "VALIDATION_ERROR", "message": "Проверьте заполненные поля.", "fields": fields,
	}})
	return true
}

func fail(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}

func internalError(c *gin.Context) {
	fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Внутренняя ошибка сервера.")
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
	if !decode(c, &input) {
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
	if validationError(c, fields) {
		return
	}
	passwordHash := hashPassword(input.Password)
	ctx := c.Request.Context()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		internalError(c)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	user, err := scanUser(tx.QueryRow(ctx, `INSERT INTO users (email, password_hash, role, name)
        VALUES ($1, $2, $3, $4) RETURNING id::text, email, name, bio, role, created_at, 0`,
		input.Email, passwordHash, input.Role, input.Name))
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) && pgerr.Code == "23505" {
		fail(c, http.StatusConflict, "EMAIL_TAKEN", "Этот email уже зарегистрирован.")
		return
	}
	if err != nil {
		internalError(c)
		return
	}
	h.respondWithSession(c, tx, user, http.StatusCreated)
}

func (h *Handler) login(c *gin.Context) {
	var input credentials
	if !decode(c, &input) || validationError(c, input.validate()) {
		return
	}
	var stored string
	user, err := scanUser(h.pool.QueryRow(c.Request.Context(),
		"SELECT "+userColumns+", u.password_hash FROM users u WHERE u.email = $1", input.Email), &stored)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		internalError(c)
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		stored = h.dummyHash
	}
	if !verifyPassword(input.Password, stored) || err != nil {
		fail(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Неверный email или пароль.")
		return
	}
	tx, err := h.pool.Begin(c.Request.Context())
	if err != nil {
		internalError(c)
		return
	}
	defer func() { _ = tx.Rollback(c.Request.Context()) }()
	h.respondWithSession(c, tx, user, http.StatusOK)
}
