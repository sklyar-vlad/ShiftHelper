package auth_test

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sklyar-vlad/ShiftHelper/backend/internal/gigs"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"go.uber.org/zap"
)

func TestCompleteGig(t *testing.T) {
	ctx, pool := testDatabase(t)
	id := func(n int) string { return fmt.Sprintf("00000000-0000-0000-0000-%012d", n) }
	_, err := pool.Exec(ctx, `
        INSERT INTO users (id, email, password_hash, role, name)
        SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
            n || '@example.test', 'test-hash', CASE WHEN n < 3 THEN 'customer' ELSE 'worker' END,
            'User ' || n FROM generate_series(1, 5) n;
        INSERT INTO gigs (id, customer_id, title, description, city, address, starts_at, ends_at, amount_kopecks)
        SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
            '00000000-0000-0000-0000-000000000001', 'Work', 'Conditions', 'Moscow', 'Example',
            now() + interval '1 day', now() + interval '2 days', 10000 FROM generate_series(101, 104) n;
        INSERT INTO applications (id, gig_id, worker_id)
        SELECT ('00000000-0000-0000-0000-' || lpad((g * 10 + w)::text, 12, '0'))::uuid,
            ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
            ('00000000-0000-0000-0000-' || lpad(w::text, 12, '0'))::uuid
        FROM generate_series(101, 104) g CROSS JOIN generate_series(3, 4) w;
    `)
	if err != nil {
		t.Fatal(err)
	}
	cookies := make([]*http.Cookie, 5)
	for n := 1; n <= 5; n++ {
		token := rand.Text()
		hash := sha256.Sum256([]byte(token))
		if _, err := pool.Exec(ctx, "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')", hash[:], id(n)); err != nil {
			t.Fatal(err)
		}
		cookies[n-1] = &http.Cookie{Name: "shifthelper_session", Value: token}
	}
	router := handler.NewRouter(zap.NewNop(), pool, "", "http://shifthelper.localhost")
	send := func(method, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, "http://shifthelper.localhost"+path, nil).WithContext(ctx)
		request.Header.Set("Origin", "http://shifthelper.localhost")
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
			t.Fatalf("expected %d, got %d: %s", status, response.Code, response.Body.String())
		}
		if code != "" {
			var payload struct{ Error struct{ Code string } }
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || payload.Error.Code != code {
				t.Fatalf("expected error %s", code)
			}
		}
	}
	base := func(g int) string { return "/api/v1/gigs/" + id(g) }
	for _, g := range []int{101, 102} {
		expect(send("POST", base(g)+"/applications/"+id(g*10+3)+"/select", cookies[0]), 200, "")
	}
	expect(send("POST", base(104)+"/cancel", cookies[0]), 200, "")
	for _, action := range []string{"submit", "confirm"} {
		cookie := cookies[2]
		if action == "confirm" {
			cookie = cookies[0]
		}
		expect(send("POST", base(101)+"/"+action, nil), 401, "UNAUTHORIZED")
		expect(send("POST", "/api/v1/gigs/bad/"+action, cookie), 400, "VALIDATION_ERROR")
		expect(send("POST", base(999)+"/"+action, cookie), 404, "NOT_FOUND")
		expect(send("POST", base(101)+"/"+action+"?userId="+id(1), cookie), 400, "VALIDATION_ERROR")
	}
	expect(send("POST", base(101)+"/submit", cookies[0]), 403, "FORBIDDEN")
	expect(send("POST", base(101)+"/confirm", cookies[2]), 403, "FORBIDDEN")
	expect(send("POST", base(101)+"/confirm", cookies[1]), 404, "NOT_FOUND")
	expect(send("POST", base(101)+"/submit", cookies[3]), 403, "FORBIDDEN")
	expect(send("POST", base(101)+"/submit", cookies[4]), 404, "NOT_FOUND")
	expect(send("POST", base(101)+"/confirm", cookies[0]), 409, "STATE_CONFLICT")
	expect(send("POST", base(103)+"/submit", cookies[2]), 403, "FORBIDDEN")
	expect(send("POST", base(103)+"/confirm", cookies[0]), 409, "STATE_CONFLICT")
	expect(send("POST", base(104)+"/submit", cookies[2]), 403, "FORBIDDEN")
	expect(send("POST", base(104)+"/confirm", cookies[0]), 409, "STATE_CONFLICT")

	double := func(path string, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		start := make(chan struct{})
		results := make(chan *httptest.ResponseRecorder, 2)
		for range 2 {
			go func() { <-start; results <- send("POST", path, cookie) }()
		}
		close(start)
		var success *httptest.ResponseRecorder
		for range 2 {
			result := <-results
			if result.Code == 200 {
				if success != nil {
					t.Fatal("transition succeeded twice")
				}
				success = result
			} else {
				expect(result, 409, "STATE_CONFLICT")
			}
		}
		if success == nil {
			t.Fatal("transition did not succeed")
		}
		return success
	}
	before := time.Now()
	response := double(base(101)+"/submit", cookies[2])
	var submitted, completed gigs.Gig
	if err := json.Unmarshal(response.Body.Bytes(), &submitted); err != nil || submitted.Status != "awaiting_confirmation" || submitted.SubmittedAt == nil || submitted.SubmittedAt.Before(before) || submitted.CompletedAt != nil || submitted.MyApplication == nil || submitted.MyApplication.Status != "selected" || submitted.Customer.CompletedGigsCount != 0 {
		t.Fatal("incorrect submission")
	}
	expect(send("POST", base(101)+"/cancel", cookies[0]), 409, "STATE_CONFLICT")
	response = double(base(101)+"/confirm", cookies[0])
	if err := json.Unmarshal(response.Body.Bytes(), &completed); err != nil || completed.Status != "completed" || completed.SubmittedAt == nil || !completed.SubmittedAt.Equal(*submitted.SubmittedAt) || completed.CompletedAt == nil || completed.CompletedAt.Before(*completed.SubmittedAt) || completed.MyApplication != nil || completed.Customer.CompletedGigsCount != 1 || completed.SelectedWorker == nil || completed.SelectedWorker.CompletedGigsCount != 1 {
		t.Fatal("incorrect confirmation or counters")
	}
	for _, private := range []string{"email", "password", "token_hash"} {
		if strings.Contains(response.Body.String(), private) {
			t.Fatal("completion exposes private fields")
		}
	}
	expect(send("POST", base(101)+"/submit", cookies[2]), 409, "STATE_CONFLICT")
	expect(send("POST", base(101)+"/confirm", cookies[0]), 409, "STATE_CONFLICT")
	var updated time.Time
	if err := pool.QueryRow(ctx, "SELECT updated_at FROM gigs WHERE id = $1", id(101)).Scan(&updated); err != nil || !updated.Equal(completed.UpdatedAt) {
		t.Fatal("repeated actions changed completion history")
	}
	for _, n := range []int{1, 3, 4} {
		want := int64(1)
		if n == 4 {
			want = 0
		}
		for _, path := range []string{"/api/v1/me", "/api/v1/users/" + id(n)} {
			response := send("GET", path, cookies[n-1])
			expect(response, 200, "")
			var profile struct{ CompletedGigsCount int64 }
			if err := json.Unmarshal(response.Body.Bytes(), &profile); err != nil || profile.CompletedGigsCount != want {
				t.Fatal("profile counter was not refreshed exactly once")
			}
		}
	}
	for _, n := range []int{1, 3, 4} {
		expect(send("GET", base(101), cookies[n-1]), 200, "")
	}
	expect(send("GET", base(101), cookies[4]), 404, "NOT_FOUND")

	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, 2)
	go func() { <-start; results <- send("POST", base(102)+"/submit", cookies[2]) }()
	go func() { <-start; results <- send("POST", base(102)+"/confirm", cookies[0]) }()
	close(start)
	for range 2 {
		result := <-results
		if result.Code != 200 {
			expect(result, 409, "STATE_CONFLICT")
		}
	}
	response = send("GET", base(102), cookies[0])
	expect(response, 200, "")
	if err := json.Unmarshal(response.Body.Bytes(), &completed); err != nil {
		t.Fatal(err)
	}
	if completed.Status == "awaiting_confirmation" {
		expect(send("POST", base(102)+"/confirm", cookies[0]), 200, "")
	} else if completed.Status != "completed" {
		t.Fatal("concurrent submit and confirm left an invalid state")
	}
}
