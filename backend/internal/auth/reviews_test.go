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

	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/gigs"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/reviews"
	"go.uber.org/zap"
)

func TestReviews(t *testing.T) {
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
            now() + interval '1 day', now() + interval '2 days', 10000 FROM generate_series(101, 106) n;
        INSERT INTO applications (gig_id, worker_id)
        SELECT ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
            ('00000000-0000-0000-0000-' || lpad(w::text, 12, '0'))::uuid
        FROM generate_series(101, 106) g CROSS JOIN generate_series(3, 4) w;
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
	send := func(method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, "http://shifthelper.localhost"+path, strings.NewReader(body)).WithContext(ctx)
		request.Header.Set("Content-Type", "application/json")
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
			var body struct{ Error struct{ Code string } }
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Error.Code != code {
				t.Fatalf("expected %s: %s", code, response.Body.String())
			}
		}
	}
	base := func(n int) string { return "/api/v1/gigs/" + id(n) }
	for _, n := range []int{102, 103, 104, 106} {
		var app string
		if err := pool.QueryRow(ctx, "SELECT id::text FROM applications WHERE gig_id = $1 AND worker_id = $2", id(n), id(3)).Scan(&app); err != nil {
			t.Fatal(err)
		}
		expect(send("POST", base(n)+"/applications/"+app+"/select", "", cookies[0]), 200, "")
	}
	for _, n := range []int{103, 104, 106} {
		expect(send("POST", base(n)+"/submit", "", cookies[2]), 200, "")
	}
	for _, n := range []int{104, 106} {
		expect(send("POST", base(n)+"/confirm", "", cookies[0]), 200, "")
	}
	expect(send("POST", base(105)+"/cancel", "", cookies[0]), 200, "")
	path := base(104) + "/reviews"
	for _, method := range []string{"GET", "POST"} {
		expect(send(method, path, `{"score":5}`, nil), 401, "UNAUTHORIZED")
		expect(send(method, "/api/v1/gigs/bad/reviews", `{"score":5}`, cookies[0]), 400, "VALIDATION_ERROR")
		expect(send(method, base(999)+"/reviews", `{"score":5}`, cookies[0]), 404, "NOT_FOUND")
		expect(send(method, path+"?authorId="+id(3), `{"score":5}`, cookies[0]), 400, "VALIDATION_ERROR")
		expect(send(method, path, `{"score":5}`, cookies[1]), 404, "NOT_FOUND")
		expect(send(method, path, `{"score":5}`, cookies[3]), 403, "FORBIDDEN")
		expect(send(method, path, `{"score":5}`, cookies[4]), 404, "NOT_FOUND")
		expect(send(method, base(101)+"/reviews", `{"score":5}`, cookies[1]), 403, "FORBIDDEN")
	}
	for _, n := range []int{101, 102, 103, 105} {
		expect(send("POST", base(n)+"/reviews", `{"score":5}`, cookies[0]), 409, "STATE_CONFLICT")
	}
	for _, body := range []string{`{}`, `null`, `{"score":null}`, `{"score":0}`, `{"score":6}`, `{"score":1.5}`,
		`{"score":"5"}`, `{"score":5,"comment":null}`, `{"score":5,"recipientId":"` + id(1) + `"}`,
		`{"score":5,"comment":"\u0000"}`, `{"score":5,"comment":"` + strings.Repeat("я", 1001) + `"}`} {
		expect(send("POST", path, body, cookies[0]), 400, "VALIDATION_ERROR")
	}
	empty := send("GET", path, "", cookies[0])
	expect(empty, 200, "")
	if strings.TrimSpace(empty.Body.String()) != `{"items":[]}` {
		t.Fatal("empty reviews must be an array")
	}
	profile := send("GET", "/api/v1/users/"+id(3), "", nil)
	expect(profile, 200, "")
	var user auth.User
	if err := json.Unmarshal(profile.Body.Bytes(), &user); err != nil || user.RatingAverage != nil || user.ReviewsCount != 0 {
		t.Fatal("unrated profile must have null average and zero count")
	}

	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		go func() {
			<-start
			results <- send("POST", path, `{"score":5,"comment":"  Отличная работа  "}`, cookies[0])
		}()
	}
	close(start)
	successes := 0
	for range 2 {
		response := <-results
		if response.Code == 201 {
			successes++
			var review reviews.Review
			if err := json.Unmarshal(response.Body.Bytes(), &review); err != nil || review.ID == "" || review.GigID != id(104) || review.AuthorID != id(1) || review.RecipientID != id(3) || review.Score != 5 || review.Comment != "Отличная работа" || review.CreatedAt.IsZero() {
				t.Fatal("incorrect review response")
			}
		} else {
			expect(response, 409, "ALREADY_REVIEWED")
		}
	}
	if successes != 1 {
		t.Fatal("concurrent review must succeed exactly once")
	}
	expect(send("POST", path, `{"score":1}`, cookies[0]), 409, "ALREADY_REVIEWED")
	expect(send("POST", path, `{"score":4,"comment":"`+strings.Repeat("я", 1000)+`"}`, cookies[2]), 201, "")
	expect(send("POST", base(106)+"/reviews", `{"score":2}`, cookies[0]), 201, "")
	expect(send("POST", base(106)+"/reviews", `{"score":2}`, cookies[2]), 201, "")
	for _, cookie := range []*http.Cookie{cookies[0], cookies[2]} {
		response := send("GET", path, "", cookie)
		expect(response, 200, "")
		var list struct{ Items []reviews.Review }
		if err := json.Unmarshal(response.Body.Bytes(), &list); err != nil || len(list.Items) != 2 {
			t.Fatal("participants must see both reviews")
		}
		for _, private := range []string{"email", "password", "token"} {
			if strings.Contains(response.Body.String(), private) {
				t.Fatal("reviews expose private data")
			}
		}
	}
	for _, n := range []int{1, 3} {
		want := 3.0
		if n == 3 {
			want = 3.5
		}
		for _, path := range []string{"/api/v1/users/" + id(n), "/api/v1/me"} {
			response := send("GET", path, "", cookies[n-1])
			expect(response, 200, "")
			if err := json.Unmarshal(response.Body.Bytes(), &user); err != nil || user.RatingAverage == nil || *user.RatingAverage != want || user.ReviewsCount != 2 {
				t.Fatalf("incorrect rating in %s: %s", path, response.Body.String())
			}
		}
	}
	response := send("GET", base(104), "", cookies[0])
	expect(response, 200, "")
	var gig gigs.Gig
	if err := json.Unmarshal(response.Body.Bytes(), &gig); err != nil || gig.Customer.RatingAverage == nil || *gig.Customer.RatingAverage != 3 || gig.Customer.ReviewsCount != 2 || gig.SelectedWorker == nil || gig.SelectedWorker.RatingAverage == nil || *gig.SelectedWorker.RatingAverage != 3.5 || gig.SelectedWorker.ReviewsCount != 2 {
		t.Fatal("gig profile ratings are stale")
	}
	response = send("GET", "/api/v1/gigs", "", nil)
	expect(response, 200, "")
	var catalog gigs.GigPage
	if err := json.Unmarshal(response.Body.Bytes(), &catalog); err != nil || len(catalog.Items) != 1 || catalog.Items[0].Customer.ReviewsCount != 2 {
		t.Fatal("catalog rating was not refreshed")
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM reviews").Scan(&count); err != nil || count != 4 {
		t.Fatal("invalid actions changed reviews")
	}
}
