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

func TestSelectWorker(t *testing.T) {
	ctx, pool := testDatabase(t)
	id := func(n int) string { return fmt.Sprintf("00000000-0000-0000-0000-%012d", n) }
	_, err := pool.Exec(ctx, `
        INSERT INTO users (id, email, password_hash, role, name, bio)
        SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
            n || '@example.test', 'test-hash', CASE WHEN n < 3 THEN 'customer' ELSE 'worker' END,
            'User ' || n, 'Public bio' FROM generate_series(1, 6) n;
        INSERT INTO gigs (id, customer_id, title, description, city, address, starts_at, ends_at, amount_kopecks)
        SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
            '00000000-0000-0000-0000-000000000001', 'Work', 'Conditions', 'Moscow', 'Example',
            now() + interval '1 day', now() + interval '2 days', 10000 FROM generate_series(101, 119) n;
        INSERT INTO applications (id, gig_id, worker_id)
        SELECT ('00000000-0000-0000-0000-' || lpad((g * 10 + w)::text, 12, '0'))::uuid,
            ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
            ('00000000-0000-0000-0000-' || lpad(w::text, 12, '0'))::uuid
        FROM generate_series(101, 119) g CROSS JOIN generate_series(3, 5) w;
        UPDATE applications SET status = 'withdrawn' WHERE id = '00000000-0000-0000-0000-000000001023';
        UPDATE applications SET status = 'rejected' WHERE id = '00000000-0000-0000-0000-000000001024';
    `)
	if err != nil {
		t.Fatal(err)
	}
	cookies := make([]*http.Cookie, 6)
	for n := 1; n <= 6; n++ {
		token := rand.Text()
		hash := sha256.Sum256([]byte(token))
		if _, err := pool.Exec(ctx, "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')", hash[:], id(n)); err != nil {
			t.Fatal(err)
		}
		cookies[n-1] = &http.Cookie{Name: "shifthelper_session", Value: token}
	}
	router := handler.NewRouter(zap.NewNop(), pool, "", "http://shifthelper.localhost")
	send := func(method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, "http://shifthelper.localhost"+path, strings.NewReader(body)).WithContext(ctx)
		request.Header.Set("Origin", "http://shifthelper.localhost")
		request.Header.Set("Content-Type", "application/json")
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
		for _, private := range []string{"email", "password", "token_hash"} {
			if strings.Contains(response.Body.String(), private) {
				t.Fatal("response exposes private account fields")
			}
		}
	}
	base := func(g int) string { return "/api/v1/gigs/" + id(g) }
	selection := func(g, w int) string { return base(g) + "/applications/" + id(g*10+w) + "/select" }
	path := selection(101, 3)
	expect(send("POST", path, "", nil), 401, "UNAUTHORIZED")
	expect(send("POST", path, "", cookies[2]), 403, "FORBIDDEN")
	expect(send("POST", path, "", cookies[1]), 403, "FORBIDDEN")
	expect(send("POST", "/api/v1/gigs/bad/applications/"+id(1013)+"/select", "", cookies[0]), 400, "VALIDATION_ERROR")
	expect(send("POST", base(101)+"/applications/bad/select", "", cookies[0]), 400, "VALIDATION_ERROR")
	expect(send("POST", selection(999, 3), "", cookies[0]), 404, "NOT_FOUND")
	expect(send("POST", base(101)+"/applications/"+id(9999)+"/select", "", cookies[0]), 404, "NOT_FOUND")
	expect(send("POST", base(101)+"/applications/"+id(1023)+"/select", "", cookies[0]), 404, "NOT_FOUND")
	expect(send("POST", path+"?workerId="+id(4), "", cookies[0]), 400, "VALIDATION_ERROR")
	expect(send("POST", selection(102, 3), "", cookies[0]), 409, "STATE_CONFLICT")
	expect(send("POST", selection(102, 4), "", cookies[0]), 409, "STATE_CONFLICT")
	response := send("POST", path, "", cookies[0])
	expect(response, 200, "")
	var gig gigs.Gig
	if err := json.Unmarshal(response.Body.Bytes(), &gig); err != nil || gig.Status != "in_progress" || gig.SelectedWorker == nil || gig.SelectedWorker.ID != id(3) || gig.SelectedWorker.Bio != "Public bio" || gig.SelectedWorker.CompletedGigsCount != 0 || gig.PendingApplicationsCount != 0 || gig.MyApplication != nil || gig.Description != "Conditions" {
		t.Fatal("incorrect selection response")
	}
	expect(send("POST", path, "", cookies[0]), 409, "STATE_CONFLICT")
	expect(send("POST", selection(101, 4), "", cookies[0]), 409, "STATE_CONFLICT")
	expect(send("POST", path, "", cookies[1]), 404, "NOT_FOUND")
	expect(send("POST", base(101)+"/cancel", "", cookies[0]), 409, "STATE_CONFLICT")
	expect(send("POST", base(101)+"/applications", "{}", cookies[5]), 404, "NOT_FOUND")
	expect(send("POST", base(101)+"/applications", "{}", cookies[3]), 409, "ALREADY_APPLIED")
	var updated time.Time
	if err := pool.QueryRow(ctx, "SELECT updated_at FROM gigs WHERE id = $1", id(101)).Scan(&updated); err != nil || !updated.Equal(gig.UpdatedAt) {
		t.Fatal("failed transitions changed gig history")
	}
	for _, w := range []int{3, 4, 5} {
		response := send("GET", base(101), "", cookies[w-1])
		expect(response, 200, "")
		if err := json.Unmarshal(response.Body.Bytes(), &gig); err != nil || gig.MyApplication == nil {
			t.Fatal("participant cannot read own application")
		}
		want := "rejected"
		if w == 3 {
			want = "selected"
		}
		if gig.MyApplication.Status != want {
			t.Fatalf("worker %d: expected %s", w, want)
		}
	}
	expect(send("GET", base(101), "", nil), 404, "NOT_FOUND")
	expect(send("POST", selection(102, 5), "", cookies[0]), 200, "")
	var withdrawn, rejected int
	if err := pool.QueryRow(ctx, "SELECT count(*) FILTER (WHERE status = 'withdrawn'), count(*) FILTER (WHERE status = 'rejected') FROM applications WHERE gig_id = $1", id(102)).Scan(&withdrawn, &rejected); err != nil || withdrawn != 1 || rejected != 1 {
		t.Fatal("selection changed inactive applications")
	}

	for i := 0; i < 15; i++ {
		g := 103 + i
		otherPath, otherCookie := selection(g, 4), cookies[0]
		if i%3 == 1 {
			otherPath = base(g) + "/cancel"
		}
		if i%3 == 2 {
			otherPath, otherCookie = base(g)+"/applications/"+id(g*10+3)+"/withdraw", cookies[2]
		}
		start := make(chan struct{})
		results := make(chan *httptest.ResponseRecorder, 2)
		go func() { <-start; results <- send("POST", selection(g, 3), "", cookies[0]) }()
		go func() { <-start; results <- send("POST", otherPath, "", otherCookie) }()
		close(start)
		codes := map[int]int{}
		for range 2 {
			result := <-results
			codes[result.Code]++
			if result.Code != 200 {
				expect(result, 409, "STATE_CONFLICT")
			}
		}
		if codes[200] != 1 || codes[409] != 1 {
			t.Fatalf("race %d: expected one success and one conflict, got %v", i, codes)
		}
		var status string
		var selected, pending int
		var consistent bool
		err := pool.QueryRow(ctx, `SELECT g.status,
            count(*) FILTER (WHERE a.status = 'selected'), count(*) FILTER (WHERE a.status = 'pending'),
            COALESCE(bool_and(a.worker_id = g.selected_worker_id) FILTER (WHERE a.status = 'selected'), g.selected_worker_id IS NULL)
            FROM gigs g JOIN applications a ON a.gig_id = g.id WHERE g.id = $1 GROUP BY g.id`, id(g)).Scan(&status, &selected, &pending, &consistent)
		if err != nil {
			t.Fatal(err)
		}
		if !consistent || (status == "in_progress" && (selected != 1 || pending != 0)) || (status == "cancelled" && (selected != 0 || pending != 0)) || (status == "open" && (i%3 != 2 || selected != 0 || pending != 2)) {
			t.Fatalf("race %d left inconsistent state: %s, selected=%d pending=%d", i, status, selected, pending)
		}
	}
}
