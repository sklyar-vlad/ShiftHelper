package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

const cookieName = "shifthelper_session"
const sessionMaxAge = 7 * 24 * 60 * 60

func (h *Handler) checkOrigin(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if c.Request.URL.RawQuery != "" {
		fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Неизвестные параметры запроса.")
		return
	}
	if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead || c.Request.Method == http.MethodOptions {
		return
	}
	origin := c.GetHeader("Origin")
	if origin == "" {
		if referer, err := url.Parse(c.GetHeader("Referer")); err == nil && referer.User == nil {
			origin = referer.Scheme + "://" + referer.Host
		}
	}
	if origin != h.origin {
		fail(c, http.StatusForbidden, "FORBIDDEN", "Запрос должен быть отправлен с сайта ShiftHelper.")
	}
}

func (h *Handler) setCookie(c *gin.Context, token string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: cookieName, Value: token, Path: "/", MaxAge: maxAge,
		HttpOnly: true, Secure: strings.HasPrefix(h.origin, "https://"), SameSite: http.SameSiteLaxMode,
	})
}

func (h *Handler) respondWithSession(c *gin.Context, tx pgx.Tx, user User, status int) {
	ctx := c.Request.Context()
	if old, err := c.Cookie(cookieName); err == nil {
		hash := sha256.Sum256([]byte(old))
		if _, err := tx.Exec(ctx, "DELETE FROM sessions WHERE token_hash = $1", hash[:]); err != nil {
			internalError(c)
			return
		}
	}
	token := rand.Text()
	hash := sha256.Sum256([]byte(token))
	if _, err := tx.Exec(ctx, `INSERT INTO sessions (token_hash, user_id, expires_at)
        VALUES ($1, $2, now() + interval '7 days')`, hash[:], user.ID); err != nil {
		internalError(c)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		internalError(c)
		return
	}
	h.setCookie(c, token, sessionMaxAge)
	c.JSON(status, user)
}

func (h *Handler) logout(c *gin.Context) {
	if token, err := c.Cookie(cookieName); err == nil {
		hash := sha256.Sum256([]byte(token))
		if _, err := h.pool.Exec(c.Request.Context(), "DELETE FROM sessions WHERE token_hash = $1", hash[:]); err != nil {
			internalError(c)
			return
		}
	}
	h.setCookie(c, "", -1)
	c.Status(http.StatusNoContent)
}

func UserFromContext(c *gin.Context) *User {
	user, _ := c.Get("auth.user")
	value, _ := user.(*User)
	return value
}

func (h *Handler) RequireUser() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		token, err := c.Cookie(cookieName)
		if err != nil || token == "" {
			fail(c, http.StatusUnauthorized, "UNAUTHORIZED", "Войдите в аккаунт.")
			return
		}
		hash := sha256.Sum256([]byte(token))
		user, err := scanUser(h.pool.QueryRow(c.Request.Context(), "SELECT "+userColumns+`
            FROM users u JOIN sessions s ON s.user_id = u.id
            WHERE s.token_hash = $1 AND s.expires_at > now()`, hash[:]))
		if errors.Is(err, pgx.ErrNoRows) {
			fail(c, http.StatusUnauthorized, "UNAUTHORIZED", "Сессия истекла. Войдите снова.")
			return
		}
		if err != nil {
			internalError(c)
			return
		}
		c.Set("auth.user", &user)
	}
}

func RequireRole(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		user := UserFromContext(c)
		if user == nil {
			fail(c, http.StatusUnauthorized, "UNAUTHORIZED", "Войдите в аккаунт.")
		} else if user.Role != role {
			fail(c, http.StatusForbidden, "FORBIDDEN", "Действие недоступно для вашей роли.")
		}
	}
}
