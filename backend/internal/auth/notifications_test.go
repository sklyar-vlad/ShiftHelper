package auth_test

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/notifications"
	"go.uber.org/zap"
)

func TestPersonalNotifications(t *testing.T) {
	ctx, pool := testDatabase(t)
	const owner = "00000000-0000-0000-0000-000000000001"
	const worker = "00000000-0000-0000-0000-000000000002"
	const origin = "http://shifthelper.localhost"
	const path = "/api/v1/me/notifications"
	_, err := pool.Exec(ctx, `INSERT INTO users (id, email, password_hash, role, name) VALUES
		('00000000-0000-0000-0000-000000000001', 'owner@example.test', 'test-hash', 'customer', 'Заказчик'),
		('00000000-0000-0000-0000-000000000002', 'worker@example.test', 'test-hash', 'worker', 'Исполнитель')`)
	if err != nil {
		t.Fatal(err)
	}
	var gigID string
	if err := pool.QueryRow(ctx, `INSERT INTO gigs (customer_id, title, description, city, address, starts_at, ends_at, amount_kopecks)
		VALUES ($1, 'Переезд', 'Коробки', 'Москва', 'Пример', now(), now() + interval '1 day', 10000) RETURNING id`,
		owner).Scan(&gigID); err != nil {
		t.Fatal(err)
	}
	newSession := func(user string) *http.Cookie {
		t.Helper()
		token := rand.Text()
		hash := sha256.Sum256([]byte(token))
		if _, err := pool.Exec(ctx, "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,now()+interval '1 day')",
			hash[:], user); err != nil {
			t.Fatal(err)
		}
		return &http.Cookie{Name: "shifthelper_session", Value: token}
	}
	ownerCookie, workerCookie := newSession(owner), newSession(worker)
	router := handler.NewRouter(zap.NewNop(), pool, "", origin)
	send := func(method, path string, cookie *http.Cookie, status int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, origin+path, nil).WithContext(ctx)
		req.Header.Set("Origin", origin)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != status {
			t.Fatalf("%s %s: expected %d, got %d: %s", method, path, status, res.Code, res.Body.String())
		}
		return res
	}
	list := func(cookie *http.Cookie, query string, unread int64, size int) notifications.Page {
		t.Helper()
		res := send(http.MethodGet, path+query, cookie, http.StatusOK)
		var page notifications.Page
		if err := json.Unmarshal(res.Body.Bytes(), &page); err != nil || page.UnreadCount != unread ||
			page.Items == nil || len(page.Items) != size || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("unexpected notification page: %s", res.Body.String())
		}
		return page
	}
	record := func(commit bool, events ...notifications.Event) {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()
		for _, event := range events {
			if err := notifications.Record(ctx, tx, event); err != nil {
				t.Fatal(err)
			}
		}
		if commit {
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
		}
	}
	event := func(user, key, title string) notifications.Event {
		return notifications.Event{RecipientID: user, Key: key, Type: "gig_changed", GigID: gigID, GigTitle: title}
	}
	send(http.MethodGet, path, nil, http.StatusUnauthorized)
	send(http.MethodPost, path+"/read-all", nil, http.StatusUnauthorized)
	send(http.MethodPost, path+"/00000000-0000-0000-0000-000000000001/read", nil, http.StatusUnauthorized)
	for _, query := range []string{"pageSize=0", "pageSize=101", "cursor=", "cursor=malformed", "cursor=x&cursor=y", "recipientId=" + worker} {
		send(http.MethodGet, path+"?"+query, ownerCookie, http.StatusBadRequest)
	}
	list(ownerCookie, "", 0, 0)
	record(false, event(owner, "rolled-back", "Отменённое событие"))
	record(true,
		event(owner, "v1", "Первая редакция"),
		event(owner, "v1", "Повтор"),
		event(owner, "v2", "Вторая редакция"),
		event(worker, "v1", "Событие исполнителя"),
	)
	if _, err := pool.Exec(ctx, "UPDATE notifications SET created_at = '2025-01-01T00:00:00.123456Z'"); err != nil {
		t.Fatal(err)
	}
	first := list(ownerCookie, "?pageSize=1", 2, 1)
	if first.NextCursor == nil || first.Items[0].GigID == nil || *first.Items[0].GigID != gigID ||
		first.Items[0].ReadAt != nil || first.Items[0].Type != "gig_changed" {
		t.Fatal("incorrect first notification page")
	}
	record(true, event(owner, "v3", "Новая редакция"))
	second := list(ownerCookie, "?pageSize=1&cursor="+*first.NextCursor, 3, 1)
	titles := []string{first.Items[0].GigTitle, second.Items[0].GigTitle}
	slices.Sort(titles)
	if second.NextCursor != nil || second.Items[0].ID >= first.Items[0].ID ||
		!slices.Equal(titles, []string{"Вторая редакция", "Первая редакция"}) {
		t.Fatal("pagination shifted after insertion or did not break timestamp ties by ID")
	}
	foreign := list(workerCookie, "", 1, 1).Items[0]
	readOwn := path + "/" + first.Items[0].ID + "/read"
	send(http.MethodPost, path+"/invalid/read", ownerCookie, http.StatusBadRequest)
	send(http.MethodPost, path+"/"+foreign.ID+"/read", ownerCookie, http.StatusNotFound)
	send(http.MethodPost, readOwn, workerCookie, http.StatusNotFound)
	send(http.MethodPost, readOwn, ownerCookie, http.StatusNoContent)
	firstRead := list(ownerCookie, "", 2, 3).Items[1].ReadAt
	send(http.MethodPost, readOwn, ownerCookie, http.StatusNoContent)
	repeated := list(ownerCookie, "", 2, 3).Items[1].ReadAt
	if firstRead == nil || repeated == nil || !firstRead.Equal(*repeated) {
		t.Fatal("reading twice changed the original read timestamp")
	}
	for range 2 {
		send(http.MethodPost, path+"/read-all", ownerCookie, http.StatusNoContent)
	}
	for _, item := range list(ownerCookie, "", 0, 3).Items {
		if item.ReadAt == nil {
			t.Fatal("mass read left an existing notification unread")
		}
	}
	list(workerCookie, "", 1, 1)
	record(true, event(owner, "v4", "Следующее событие"))
	send(http.MethodPost, "/api/v1/auth/logout", ownerCookie, http.StatusNoContent)
	send(http.MethodGet, path, ownerCookie, http.StatusUnauthorized)
	router = handler.NewRouter(zap.NewNop(), pool, "", origin)
	fresh := list(newSession(owner), "", 1, 4)
	if fresh.Items[0].GigTitle != "Следующее событие" || fresh.Items[0].ReadAt != nil {
		t.Fatal("new events were marked read or lost across sessions")
	}
}
