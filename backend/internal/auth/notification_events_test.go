package auth_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/sklyar-vlad/ShiftHelper/backend/internal/gigs"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/notifications"
	"go.uber.org/zap"
)

func TestGigNotificationEvents(t *testing.T) {
	ctx, pool := testDatabase(t)
	const origin = "http://shifthelper.localhost"
	const feed = "/me/notifications"
	router := handler.NewRouter(zap.NewNop(), pool, "", origin)
	send := func(method, path string, user *http.Cookie, data any, status int) *httptest.ResponseRecorder {
		t.Helper()
		var body []byte
		if data != nil {
			var err error
			body, err = json.Marshal(data)
			if err != nil {
				t.Fatal(err)
			}
		}
		req := httptest.NewRequest(method, origin+"/api/v1"+path, bytes.NewReader(body)).WithContext(ctx)
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		if user != nil {
			req.AddCookie(user)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != status {
			t.Fatalf("%s %s: expected %d, got %d: %s", method, path, status, res.Code, res.Body.String())
		}
		return res
	}
	var cookies []*http.Cookie
	for index, role := range []string{"customer", "worker", "worker", "worker"} {
		res := send("POST", "/auth/register", nil, map[string]string{
			"name": fmt.Sprintf("Пользователь %d", index), "email": fmt.Sprintf("event-%d@example.test", index),
			"role": role, "password": "demo-test-notifications",
		}, 201)
		cookies = append(cookies, res.Result().Cookies()[0])
	}
	owner, selected, rejected, withdrawn := cookies[0], cookies[1], cookies[2], cookies[3]
	start := time.Now().UTC().Add(time.Hour)
	terms := func(title string) map[string]any {
		return map[string]any{
			"title": title, "description": "Помощь", "requirements": "", "city": "Москва", "address": "Пример",
			"startsAt": start.Format(time.RFC3339), "endsAt": start.Add(time.Hour).Format(time.RFC3339), "amountKopecks": 10000,
		}
	}
	decodeGig := func(res *httptest.ResponseRecorder) gigs.Gig {
		t.Helper()
		var gig gigs.Gig
		if err := json.Unmarshal(res.Body.Bytes(), &gig); err != nil || gig.ID == "" {
			t.Fatalf("invalid gig: %s", res.Body.String())
		}
		return gig
	}
	create := func(title string) gigs.Gig {
		return decodeGig(send("POST", "/gigs", owner, terms(title), 201))
	}
	apply := func(path string, user *http.Cookie) string {
		t.Helper()
		res := send("POST", path+"/applications", user, map[string]any{}, 201)
		var application gigs.Application
		if err := json.Unmarshal(res.Body.Bytes(), &application); err != nil || application.ID == "" {
			t.Fatalf("invalid application: %s", res.Body.String())
		}
		return path + "/applications/" + application.ID
	}
	edit := func(path, title string, version int, status int) *httptest.ResponseRecorder {
		request := terms(title)
		request["termsVersion"] = version
		return send("PUT", path+"/terms", owner, request, status)
	}
	check := func(user *http.Cookie, want ...string) []notifications.Notification {
		t.Helper()
		res := send("GET", feed, user, nil, 200)
		var result notifications.Page
		if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil || result.UnreadCount != int64(len(want)) {
			t.Fatalf("unexpected feed: %s", res.Body.String())
		}
		got := make([]string, 0, len(result.Items))
		for _, item := range result.Items {
			if item.GigID == nil || item.GigTitle == "" || item.ReadAt != nil {
				t.Fatalf("invalid notification: %+v", item)
			}
			got = append(got, item.Type)
		}
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			t.Fatalf("notification types = %v, want %v", got, want)
		}
		return result.Items
	}

	gig := create("Переезд")
	path := "/gigs/" + gig.ID
	selectedApp := apply(path, selected)
	apply(path, rejected)
	withdrawnApp := apply(path, withdrawn)
	send("POST", withdrawnApp+"/withdraw", withdrawn, nil, 200)
	send("POST", path+"/applications", selected, map[string]any{}, 409)
	check(owner, "application_created", "application_created", "application_created")

	edit(path, "Редакция 2", 1, 200)
	edit(path, "Устаревшая редакция", 1, 409)
	edit(path, "Редакция 3", 2, 200)
	for _, user := range []*http.Cookie{selected, rejected} {
		items := check(user, "gig_terms_changed", "gig_terms_changed")
		if items[0].GigTitle != "Редакция 3" || items[1].GigTitle != "Редакция 2" {
			t.Fatal("terms notifications should retain each revision's title")
		}
	}
	check(withdrawn)
	send("POST", selectedApp+"/select", owner, nil, 409)
	send("POST", selectedApp+"/confirm-terms", selected, map[string]int{"termsVersion": 3}, 200)
	send("POST", selectedApp+"/select", rejected, nil, 403)

	if _, err := pool.Exec(ctx, "ALTER TABLE notifications ADD CONSTRAINT force_selection_rollback CHECK (type <> 'application_rejected')"); err != nil {
		t.Fatal(err)
	}
	send("POST", selectedApp+"/select", owner, nil, 500)
	if current := decodeGig(send("GET", path, owner, nil, 200)); current.Status != "open" || current.PendingApplicationsCount != 2 {
		t.Fatal("failed notification insertion did not roll back selection")
	}
	check(selected, "gig_terms_changed", "gig_terms_changed")
	if _, err := pool.Exec(ctx, "ALTER TABLE notifications DROP CONSTRAINT force_selection_rollback"); err != nil {
		t.Fatal(err)
	}
	send("POST", selectedApp+"/select", owner, nil, 200)
	send("POST", selectedApp+"/select", owner, nil, 409)

	propose := func(title string, version int) string {
		t.Helper()
		gig := decodeGig(edit(path, title, version, 200))
		if gig.PendingChange == nil {
			t.Fatal("missing pending proposal")
		}
		return path + "/changes/" + gig.PendingChange.ID
	}
	proposal := propose("Предложение на отказ", 3)
	send("POST", proposal+"/reject", selected, nil, 200)
	send("POST", proposal+"/reject", selected, nil, 409)
	proposal = propose("Предложение на отзыв", 3)
	send("POST", proposal+"/withdraw", owner, nil, 200)
	proposal = propose("Согласованные условия", 3)
	send("POST", proposal+"/accept", selected, nil, 200)
	proposal = propose("Предложение до сдачи", 4)
	send("POST", path+"/submit", selected, nil, 200)
	send("POST", proposal+"/reject", selected, nil, 409)
	send("POST", path+"/confirm", owner, nil, 200)
	send("POST", path+"/confirm", owner, nil, 409)

	cancelled := create("Отмена")
	cancelPath := "/gigs/" + cancelled.ID
	apply(cancelPath, rejected)
	other := apply(cancelPath, withdrawn)
	send("POST", other+"/withdraw", withdrawn, nil, 200)
	send("POST", cancelPath+"/cancel", owner, map[string]string{"reason": "schedule_changed", "comment": "личное пояснение"}, 200)
	send("POST", cancelPath+"/cancel", owner, nil, 409)
	history := send("GET", "/me/applications?scope=history", rejected, nil, 200).Body.String()
	if !strings.Contains(history, gig.ID) || !strings.Contains(history, cancelled.ID) {
		t.Fatal("history links should point to accessible items")
	}

	check(owner, "application_created", "application_created", "application_created", "application_created", "application_created",
		"gig_change_accepted", "gig_change_rejected", "gig_submitted")
	check(selected, "gig_terms_changed", "gig_terms_changed", "application_selected", "gig_change_proposed",
		"gig_change_proposed", "gig_change_proposed", "gig_change_proposed", "gig_change_withdrawn", "gig_completed")
	check(withdrawn)
	items := check(rejected, "gig_terms_changed", "gig_terms_changed", "application_rejected", "gig_cancelled")
	if items[0].Type != "gig_cancelled" || items[0].CancellationReason == nil || *items[0].CancellationReason != "schedule_changed" {
		t.Fatal("cancelled notification lost its reason")
	}
	raw := send("GET", feed, rejected, nil, 200).Body.String()
	for _, private := range []string{"личное пояснение", "event-0@example.test", "recipientId", "eventKey"} {
		if strings.Contains(raw, private) {
			t.Fatalf("feed contains private data: %q", private)
		}
	}
}
