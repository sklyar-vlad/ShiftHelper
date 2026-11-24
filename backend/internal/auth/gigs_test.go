package auth_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/gigs"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"go.uber.org/zap"
)

func TestGigPublicationAndCancellation(t *testing.T) {
	t.Setenv("GEOAPIFY_GEOCODING_KEY", "")
	ctx, pool := testDatabase(t)
	const origin = "http://shifthelper.localhost"
	router := handler.NewRouter(zap.NewNop(), pool, "", origin)
	send := func(path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		request := httptest.NewRequest("POST", origin+path, strings.NewReader(body)).WithContext(ctx)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", origin)
		if cookie != nil {
			request.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	expect := func(response *httptest.ResponseRecorder, status int, code string) {
		t.Helper()
		if response.Code != status {
			t.Fatalf("expected status %d, got %d", status, response.Code)
		}
		if code != "" {
			var payload struct{ Error struct{ Code string } }
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || payload.Error.Code != code {
				t.Fatalf("expected error %s", code)
			}
		}
	}
	var cookies []*http.Cookie
	var accounts []auth.User
	for i, role := range []string{"customer", "customer", "worker"} {
		data, err := json.Marshal(map[string]string{"name": role, "email": []string{"owner@example.test", "other@example.test", "worker@example.test"}[i], "password": "test-password-123", "role": role})
		if err != nil {
			t.Fatal(err)
		}
		response := send("/api/v1/auth/register", string(data), nil)
		expect(response, 201, "")
		var user auth.User
		if err := json.Unmarshal(response.Body.Bytes(), &user); err != nil {
			t.Fatal(err)
		}
		accounts = append(accounts, user)
		cookies = append(cookies, response.Result().Cookies()[0])
	}
	const placeSearch = "/api/v1/gig-place-search"
	const placeInput = `{"city":"Москва","address":"Тверская, 13"}`
	expect(send(placeSearch, placeInput, nil), 401, "UNAUTHORIZED")
	expect(send(placeSearch, placeInput, cookies[2]), 403, "FORBIDDEN")
	expect(send(placeSearch, placeInput, cookies[0]), 503, "INTERNAL_ERROR")
	start := time.Now().Add(24 * time.Hour).Truncate(time.Second).In(time.FixedZone("MSK", 3*60*60))
	body := func(overrides map[string]any) string {
		input := map[string]any{"title": "  Разгрузка  ", "description": "Перенести коробки", "requirements": "", "city": "Москва", "address": "Примерная, 1",
			"startsAt": start.Format(time.RFC3339), "endsAt": start.Add(4 * time.Hour).Format(time.RFC3339), "amountKopecks": 500000}
		for key, value := range overrides {
			input[key] = value
		}
		data, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	create := func(input string) gigs.Gig {
		t.Helper()
		response := send("/api/v1/gigs", input, cookies[0])
		expect(response, 201, "")
		var gig gigs.Gig
		if err := json.Unmarshal(response.Body.Bytes(), &gig); err != nil {
			t.Fatal(err)
		}
		if gig.ID == "" || gig.Customer.ID != accounts[0].ID || gig.Status != "open" || gig.PendingApplicationsCount != 0 ||
			gig.SelectedWorker != nil || gig.MyApplication != nil || gig.CancelledAt != nil || gig.StartsAt.Location() != time.UTC {
			t.Fatal("incorrect new gig response")
		}
		if strings.Contains(response.Body.String(), "email") || strings.Contains(response.Body.String(), "password") || strings.Contains(response.Body.String(), "token") {
			t.Fatal("gig response exposes private data")
		}
		return gig
	}
	expect(send("/api/v1/gigs", body(nil), nil), 401, "UNAUTHORIZED")
	expect(send("/api/v1/gigs", body(nil), cookies[2]), 403, "FORBIDDEN")
	for _, invalid := range []map[string]any{
		{"title": " "}, {"description": ""}, {"requirements": nil}, {"amountKopecks": nil}, {"amountKopecks": -1}, {"amountKopecks": 0},
		{"amountKopecks": 10000000001}, {"amountKopecks": 1.5}, {"title": strings.Repeat("я", 151)}, {"description": strings.Repeat("я", 5001)},
		{"requirements": strings.Repeat("я", 2001)}, {"city": strings.Repeat("я", 101)}, {"address": strings.Repeat("я", 301)}, {"city": "\x00"},
		{"startsAt": time.Now().Add(-time.Hour).Format(time.RFC3339)}, {"startsAt": "2030-01-01T12:00:00"}, {"startsAt": "bad"},
		{"endsAt": start.Format(time.RFC3339)}, {"endsAt": "bad"}, {"customerId": accounts[1].ID}, {"status": "draft"},
	} {
		expect(send("/api/v1/gigs", body(invalid), cookies[0]), 400, "VALIDATION_ERROR")
	}
	for _, invalid := range []string{`{}`, `null`, `{} {}`, strings.Repeat("x", 128*1024+1)} {
		expect(send("/api/v1/gigs", invalid, cookies[0]), 400, "VALIDATION_ERROR")
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM gigs").Scan(&count); err != nil || count != 0 {
		t.Fatal("invalid publication created data")
	}
	gig := create(body(nil))
	if gig.Title != "Разгрузка" || gig.AmountKopecks != 500000 || !gig.StartsAt.Equal(start) {
		t.Fatal("publication did not preserve normalized conditions")
	}
	cancelPath := "/api/v1/gigs/" + gig.ID + "/cancel"
	expect(send(cancelPath, "", nil), 401, "UNAUTHORIZED")
	expect(send(cancelPath, "", cookies[2]), 403, "FORBIDDEN")
	expect(send(cancelPath, "", cookies[1]), 403, "FORBIDDEN")
	expect(send("/api/v1/gigs/bad/cancel", "", cookies[0]), 400, "VALIDATION_ERROR")
	expect(send("/api/v1/gigs/00000000-0000-0000-0000-000000000099/cancel", "", cookies[0]), 404, "NOT_FOUND")
	if _, err := pool.Exec(ctx, "INSERT INTO applications (gig_id, worker_id) VALUES ($1, $2)", gig.ID, accounts[2].ID); err != nil {
		t.Fatal(err)
	}
	response := send(cancelPath, "", cookies[0])
	expect(response, 200, "")
	var cancelled gigs.Gig
	if err := json.Unmarshal(response.Body.Bytes(), &cancelled); err != nil || cancelled.Status != "cancelled" || cancelled.CancelledAt == nil || cancelled.PendingApplicationsCount != 0 {
		t.Fatal("incorrect cancellation response")
	}
	if cancelled.Cancellation == nil || *cancelled.Cancellation != (gigs.Cancellation{}) {
		t.Fatal("legacy cancellation should have no reason or comment")
	}
	var applicationStatus string
	if err := pool.QueryRow(ctx, "SELECT status FROM applications WHERE gig_id = $1", gig.ID).Scan(&applicationStatus); err != nil || applicationStatus != "rejected" {
		t.Fatal("pending application was not rejected")
	}
	expect(send(cancelPath, "", cookies[0]), 409, "STATE_CONFLICT")
	expect(send(cancelPath, "", cookies[1]), 404, "NOT_FOUND")
	var cancelledAt time.Time
	if err := pool.QueryRow(ctx, "SELECT cancelled_at FROM gigs WHERE id = $1", gig.ID).Scan(&cancelledAt); err != nil || !cancelledAt.Equal(*cancelled.CancelledAt) {
		t.Fatal("repeated cancellation changed history")
	}
	selected := create(body(nil))
	if _, err := pool.Exec(ctx, "INSERT INTO applications (gig_id, worker_id, status) VALUES ($1, $2, 'selected')", selected.ID, accounts[2].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE gigs SET status = 'in_progress', selected_worker_id = $1 WHERE id = $2", accounts[2].ID, selected.ID); err != nil {
		t.Fatal(err)
	}
	expect(send("/api/v1/gigs/"+selected.ID+"/cancel", "", cookies[0]), 409, "STATE_CONFLICT")
	concurrent := create(body(nil))
	results := make(chan int, 2)
	for range 2 {
		go func() { results <- send("/api/v1/gigs/"+concurrent.ID+"/cancel", "", cookies[0]).Code }()
	}
	statuses := map[int]int{}
	statuses[<-results]++
	statuses[<-results]++
	if statuses[200] != 1 || statuses[409] != 1 {
		t.Fatal("concurrent cancellation must have one success and one conflict")
	}
	reasoned := create(body(nil))
	detail := "/api/v1/gigs/" + reasoned.ID
	if _, err := pool.Exec(ctx, "INSERT INTO applications (gig_id, worker_id) VALUES ($1, $2)", reasoned.ID, accounts[2].ID); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{
		`{"reason":"unknown"}`, `{"reason":null}`, `{"comment":null}`, `null`,
		`{"comment":"\u0000"}`, `{"comment":"` + strings.Repeat("😀", 501) + `"}`,
	} {
		expect(send(detail+"/cancel", invalid, cookies[0]), 400, "VALIDATION_ERROR")
	}
	if _, err := pool.Exec(ctx, "ALTER TABLE gigs ADD CHECK (cancellation_comment <> 'rollback test')"); err != nil {
		t.Fatal(err)
	}
	expect(send(detail+"/cancel", `{"reason":"other","comment":"rollback test"}`, cookies[0]), 500, "INTERNAL_ERROR")
	var status, pending string
	if err := pool.QueryRow(ctx, `SELECT g.status, a.status FROM gigs g JOIN applications a ON a.gig_id = g.id WHERE g.id = $1`, reasoned.ID).Scan(&status, &pending); err != nil ||
		status != "open" || pending != "pending" {
		t.Fatal("failed cancellation left partial changes")
	}
	comment := strings.Repeat("😀", 500)
	response = send(detail+"/cancel", `{"reason":"schedule_changed","comment":"`+comment+`"}`, cookies[0])
	expect(response, 200, "")
	var result gigs.Gig
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Cancellation == nil ||
		*result.Cancellation != (gigs.Cancellation{Reason: "schedule_changed", Comment: comment}) {
		t.Fatal("incorrect cancellation details")
	}
	get := func(path string, cookie *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", origin+path, nil).WithContext(ctx)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	for _, authorized := range []struct {
		path   string
		cookie *http.Cookie
	}{
		{detail, cookies[0]}, {detail, cookies[2]},
		{"/api/v1/me/gigs?scope=history", cookies[0]},
		{"/api/v1/me/applications?scope=history", cookies[2]},
	} {
		res := get(authorized.path, authorized.cookie)
		expect(res, 200, "")
		if !strings.Contains(res.Body.String(), "schedule_changed") || !strings.Contains(res.Body.String(), comment) {
			t.Fatalf("missing cancellation details in %s", authorized.path)
		}
	}
	expect(get(detail, nil), 404, "NOT_FOUND")
	expect(get(detail, cookies[1]), 404, "NOT_FOUND")
	if res := get("/api/v1/gigs", nil); res.Code != 200 || strings.Contains(res.Body.String(), reasoned.ID) {
		t.Fatal("public catalog exposes cancelled gig")
	}
	create(body(map[string]any{"title": strings.Repeat("😀", 150), "description": strings.Repeat("😀", 5000),
		"requirements": strings.Repeat("😀", 2000), "city": strings.Repeat("😀", 100), "address": strings.Repeat("😀", 300), "amountKopecks": 10000000000}))
}
