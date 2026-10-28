package auth_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/migrations"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestAuthentication(t *testing.T) {
	ctx, pool := testDatabase(t)
	const origin = "http://shifthelper.localhost"
	gin.SetMode(gin.ReleaseMode)
	core, logs := observer.New(zap.InfoLevel)
	router := handler.NewRouter(zap.New(core), pool, "", origin)
	h := auth.NewHandler(pool, origin)
	for _, role := range []string{"customer", "worker"} {
		router.GET("/test/"+role, h.RequireUser(), auth.RequireRole(role), func(c *gin.Context) { c.Status(204) })
	}
	serve := func(request *http.Request) *httptest.ResponseRecorder {
		t.Helper()
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		return recorder
	}
	send := func(method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, origin+path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", origin)
		if cookie != nil {
			request.AddCookie(cookie)
		}
		return serve(request)
	}
	expect := func(response *httptest.ResponseRecorder, status int, code string) {
		t.Helper()
		if response.Code != status {
			t.Fatalf("expected status %d, got %d", status, response.Code)
		}
		if code != "" {
			var body struct{ Error struct{ Code string } }
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Error.Code != code {
				t.Fatalf("expected error %s", code)
			}
		}
	}
	password := "  пароль" + strings.Repeat("я", 90) + "  "
	body := func(email, role string) string {
		data, err := json.Marshal(map[string]string{"name": "  Алексей  ", "email": email, "password": password, "role": role})
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	loginBody := func(email, password string) string {
		data, err := json.Marshal(map[string]string{"email": email, "password": password})
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	expect(send("GET", "/api/v1/me", "", nil), 401, "UNAUTHORIZED")
	expect(send("GET", "/api/v1/me", "", &http.Cookie{Name: "shifthelper_session", Value: "forged"}), 401, "UNAUTHORIZED")
	var cookies []*http.Cookie
	var users []auth.User
	for _, role := range []string{"customer", "worker"} {
		response := send("POST", "/api/v1/auth/register", body("  "+strings.ToUpper(role)+"@EXAMPLE.TEST  ", role), nil)
		expect(response, 201, "")
		cookie := response.Result().Cookies()[0]
		if cookie.Name != "shifthelper_session" || !cookie.HttpOnly || cookie.Secure || cookie.Domain != "" ||
			cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode || cookie.MaxAge != 604800 {
			t.Fatal("incorrect session cookie attributes")
		}
		var user auth.User
		if err := json.Unmarshal(response.Body.Bytes(), &user); err != nil {
			t.Fatal(err)
		}
		if user.Role != role || user.Email != role+"@example.test" || user.Name != "Алексей" || user.ID == "" ||
			user.CompletedGigsCount != 0 || user.CreatedAt.Location() != time.UTC {
			t.Fatal("incorrect current user response")
		}
		if bytes.Contains(response.Body.Bytes(), []byte(password)) || bytes.Contains(response.Body.Bytes(), []byte(cookie.Value)) ||
			strings.Contains(response.Body.String(), "password") || strings.Contains(response.Body.String(), "token") {
			t.Fatal("response exposes a secret")
		}
		current := send("GET", "/api/v1/me", "", cookie)
		expect(current, 200, "")
		if current.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("private response can be cached")
		}
		expect(send("GET", "/test/"+role, "", cookie), 204, "")
		var hash string
		var storedToken []byte
		var lifetime int64
		err := pool.QueryRow(ctx, `SELECT u.password_hash, s.token_hash,
            extract(epoch FROM (s.expires_at - s.created_at))::bigint
            FROM users u JOIN sessions s ON s.user_id = u.id WHERE u.id = $1`, user.ID).Scan(&hash, &storedToken, &lifetime)
		wantToken := sha256.Sum256([]byte(cookie.Value))
		if err != nil || !strings.HasPrefix(hash, "$argon2id$") || !bytes.Equal(storedToken, wantToken[:]) || lifetime != 604800 {
			t.Fatal("password/session storage is incorrect")
		}
		cookies = append(cookies, cookie)
		users = append(users, user)
	}
	expect(send("GET", "/test/customer", "", cookies[1]), 403, "FORBIDDEN")
	expect(send("GET", "/test/worker", "", cookies[0]), 403, "FORBIDDEN")
	expect(send("GET", "/test/customer", "", nil), 401, "UNAUTHORIZED")
	expect(send("PATCH", "/api/v1/me", `{"name":"Name","bio":""}`, nil), 401, "UNAUTHORIZED")
	for i, cookie := range cookies {
		response := send("PATCH", "/api/v1/me", `{"name":"  Новое имя  ","bio":"  Обо мне  "}`, cookie)
		expect(response, 200, "")
		var updated auth.User
		if err := json.Unmarshal(response.Body.Bytes(), &updated); err != nil || updated.ID != users[i].ID ||
			updated.Email != users[i].Email || updated.Role != users[i].Role || updated.Name != "Новое имя" || updated.Bio != "Обо мне" {
			t.Fatal("profile update changed the wrong fields or account")
		}
		response = send("GET", "/api/v1/users/"+users[i].ID, "", nil)
		expect(response, 200, "")
		var public map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &public); err != nil || len(public) != 5 ||
			public["id"] != users[i].ID || public["name"] != "Новое имя" || public["bio"] != "Обо мне" ||
			public["role"] != users[i].Role || public["completedGigsCount"] != float64(0) {
			t.Fatal("public profile exposes extra fields or incorrect data")
		}
		response = send("GET", "/api/v1/me", "", cookie)
		expect(response, 200, "")
		if err := json.Unmarshal(response.Body.Bytes(), &updated); err != nil || updated.Name != "Новое имя" || updated.Bio != "Обо мне" {
			t.Fatal("profile changes were not persisted")
		}
	}
	for _, invalid := range []string{
		`{}`, `null`, `{"name":"Name"}`, `{"bio":""}`, `{"name":null,"bio":""}`, `{"name":"Name","bio":null}`,
		`{"name":" ","bio":""}`, `{"name":"Name","bio":1}`, `{} {}`,
		`{"name":"\u0000","bio":""}`, `{"name":"Name","bio":"\u0000"}`,
		`{"name":"Name","bio":"","role":"worker"}`, `{"name":"Name","bio":"","email":"other@example.test"}`,
		`{"name":"Name","bio":"","id":"` + users[1].ID + `"}`,
		`{"name":"` + strings.Repeat("я", 101) + `","bio":""}`,
		`{"name":"Name","bio":"` + strings.Repeat("я", 1001) + `"}`,
	} {
		expect(send("PATCH", "/api/v1/me", invalid, cookies[0]), 400, "VALIDATION_ERROR")
	}
	request := httptest.NewRequest("PATCH", origin+"/api/v1/me", strings.NewReader(`{"name":"Foreign","bio":""}`))
	request.Header.Set("Origin", "https://foreign.test")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(cookies[0])
	expect(serve(request), 403, "FORBIDDEN")
	expect(send("GET", "/api/v1/users/bad-id", "", nil), 400, "VALIDATION_ERROR")
	expect(send("GET", "/api/v1/users/00000000X0000X0000X0000X000000000000", "", nil), 400, "VALIDATION_ERROR")
	expect(send("GET", "/api/v1/users/00000000-0000-0000-0000-000000000099", "", nil), 404, "NOT_FOUND")
	expect(send("GET", "/api/v1/users/"+users[0].ID+"?email=true", "", nil), 400, "VALIDATION_ERROR")
	expect(send("PATCH", "/api/v1/me", `{"name":"`+strings.Repeat("😀", 100)+`","bio":"`+strings.Repeat("😀", 1000)+`"}`, cookies[0]), 200, "")
	response := send("PATCH", "/api/v1/me", `{"name":"Final name","bio":"  "}`, cookies[0])
	expect(response, 200, "")
	var clearedProfile auth.User
	if err := json.Unmarshal(response.Body.Bytes(), &clearedProfile); err != nil || clearedProfile.Bio != "" {
		t.Fatal("empty bio was not cleared")
	}
	var gigID string
	err := pool.QueryRow(ctx, `INSERT INTO gigs (customer_id, title, description, city, address, starts_at, ends_at, amount_kopecks)
        VALUES ($1, 'Test', 'Work', 'Moscow', 'Example', now() + interval '1 day', now() + interval '2 days', 10000)
        RETURNING id::text`, users[0].ID).Scan(&gigID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO applications (gig_id, worker_id, status) VALUES ($1, $2, 'selected')", gigID, users[1].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE gigs SET selected_worker_id = $1, status = 'completed',
        submitted_at = now(), completed_at = now() WHERE id = $2`, users[1].ID, gigID); err != nil {
		t.Fatal(err)
	}
	for i, cookie := range cookies {
		response := send("GET", "/api/v1/me", "", cookie)
		expect(response, 200, "")
		var user auth.User
		if err := json.Unmarshal(response.Body.Bytes(), &user); err != nil || user.ID != users[i].ID || user.CompletedGigsCount != 1 {
			t.Fatal("current user or completed work count is incorrect")
		}
		response = send("GET", "/api/v1/users/"+users[i].ID, "", cookies[1-i])
		expect(response, 200, "")
		var public map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &public); err != nil || len(public) != 5 || public["completedGigsCount"] != float64(1) {
			t.Fatal("public completed work count is incorrect or private fields were exposed")
		}
	}
	expect(send("POST", "/api/v1/auth/register", body("CUSTOMER@example.test", "worker"), cookies[0]), 409, "EMAIL_TAKEN")
	wrong := send("POST", "/api/v1/auth/login", loginBody("customer@example.test", strings.TrimSpace(password)), cookies[0])
	missing := send("POST", "/api/v1/auth/login", loginBody("missing@example.test", password), nil)
	expect(wrong, 401, "INVALID_CREDENTIALS")
	expect(missing, 401, "INVALID_CREDENTIALS")
	if wrong.Body.String() != missing.Body.String() {
		t.Fatal("login reveals whether an email exists")
	}
	expect(send("GET", "/api/v1/me", "", cookies[0]), 200, "")
	for _, invalid := range []string{
		`{}`, `null`, `{`, `{} {}`, `{"email":123}`, strings.Repeat("x", 4097),
		`{"name":"Name","email":"bad","password":"12345678","role":"worker"}`,
		`{"name":" ","email":"ok@example.test","password":"12345678","role":"worker"}`,
		`{"name":"Name","email":"ok@example.test","password":"short","role":"worker"}`,
		body("ok@example.test", "admin"),
		strings.Replace(body("ok@example.test", "worker"), `"name":`, `"extra":true,"name":`, 1),
		strings.Replace(body("ok@example.test", "worker"), password, strings.Repeat("я", 129), 1),
	} {
		expect(send("POST", "/api/v1/auth/register", invalid, nil), 400, "VALIDATION_ERROR")
	}
	expect(send("POST", "/api/v1/auth/login", body("worker@example.test", "worker"), nil), 400, "VALIDATION_ERROR")
	expect(send("GET", "/api/v1/me?role=customer", "", cookies[1]), 400, "VALIDATION_ERROR")
	for _, tc := range []struct {
		origin, referer string
		status          int
	}{
		{"", "", 403}, {"null", "", 403}, {"https://foreign.test", origin + "/", 403},
		{"", "https://foreign.test/path", 403}, {"", origin + "/profile", 204}, {origin, "", 204},
	} {
		request := httptest.NewRequest("POST", origin+"/api/v1/auth/logout", nil)
		request.Header.Set("Origin", tc.origin)
		request.Header.Set("Referer", tc.referer)
		expect(serve(request), tc.status, "")
	}
	response = send("POST", "/api/v1/auth/login", loginBody(" CUSTOMER@EXAMPLE.TEST ", password), cookies[0])
	expect(response, 200, "")
	rotated := response.Result().Cookies()[0]
	if rotated.Value == cookies[0].Value {
		t.Fatal("session was not rotated")
	}
	expect(send("GET", "/api/v1/me", "", cookies[0]), 401, "UNAUTHORIZED")
	expect(send("GET", "/api/v1/me", "", rotated), 200, "")
	response = send("POST", "/api/v1/auth/logout", "", rotated)
	expect(response, 204, "")
	cleared := response.Result().Cookies()[0]
	if cleared.Value != "" || cleared.MaxAge != -1 || !cleared.HttpOnly || cleared.Path != "/" {
		t.Fatal("logout did not clear the cookie")
	}
	expect(send("GET", "/api/v1/me", "", rotated), 401, "UNAUTHORIZED")
	expect(send("POST", "/api/v1/auth/logout", "", rotated), 204, "")
	expect(send("POST", "/api/v1/auth/logout", "", nil), 204, "")
	hash := sha256.Sum256([]byte(cookies[1].Value))
	if _, err := pool.Exec(ctx, `UPDATE sessions SET created_at = now() - interval '8 days',
        expires_at = now() - interval '1 day' WHERE token_hash = $1`, hash[:]); err != nil {
		t.Fatal(err)
	}
	expect(send("GET", "/api/v1/me", "", cookies[1]), 401, "UNAUTHORIZED")
	secure := gin.New()
	auth.NewHandler(pool, "https://shifthelper.example.test").Register(secure)
	request = httptest.NewRequest("POST", "https://shifthelper.example.test/api/v1/auth/login",
		strings.NewReader(loginBody("worker@example.test", password)))
	request.Header.Set("Origin", "https://shifthelper.example.test")
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	secure.ServeHTTP(response, request)
	expect(response, 200, "")
	if !response.Result().Cookies()[0].Secure {
		t.Fatal("HTTPS cookie is not Secure")
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&count); err != nil || count != 2 {
		t.Fatal("invalid requests changed user accounts")
	}
	var salted bool
	if err := pool.QueryRow(ctx, "SELECT count(DISTINCT password_hash) = 2 FROM users").Scan(&salted); err != nil || !salted {
		t.Fatal("password hashes are not individually salted")
	}
	for _, entry := range logs.All() {
		encoded, err := json.Marshal(entry)
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{password, cookies[0].Value, cookies[1].Value, rotated.Value} {
			if bytes.Contains(encoded, []byte(secret)) {
				t.Fatal("request log exposes a secret")
			}
		}
	}
}

func testDatabase(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run authentication tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	t.Cleanup(cancel)
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal("invalid TEST_DATABASE_URL")
	}
	admin, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := pgx.Identifier{"auth_test_" + strings.ToLower(rand.Text())}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := migrations.Run(ctx, pool, "up", io.Discard); err != nil {
		t.Fatal(err)
	}
	return ctx, pool
}
