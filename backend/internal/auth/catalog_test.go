package auth_test

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"

	"github.com/sklyar-vlad/ShiftHelper/backend/internal/gigs"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"go.uber.org/zap"
)

func TestGigCatalogAndDetails(t *testing.T) {
	ctx, pool := testDatabase(t)
	_, err := pool.Exec(ctx, `
        INSERT INTO users (id, email, password_hash, role, name) VALUES
        ('00000000-0000-0000-0000-000000000001', 'owner@example.test', 'test-hash', 'customer', 'Owner'),
        ('00000000-0000-0000-0000-000000000002', 'other@example.test', 'test-hash', 'customer', 'Other'),
        ('00000000-0000-0000-0000-000000000003', 'worker@example.test', 'test-hash', 'worker', 'Worker'),
        ('00000000-0000-0000-0000-000000000004', 'applicant@example.test', 'test-hash', 'worker', 'Applicant');
        INSERT INTO gigs (id, customer_id, title, description, requirements, city, address, starts_at, ends_at, amount_kopecks, created_at)
        SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
            '00000000-0000-0000-0000-000000000001', title, 'Full description', 'Conditions', city, 'Example 1',
            now() + interval '1 day', now() + interval '2 days', 500000, created
        FROM (VALUES
            (101, 'Разгрузка коробок', 'Москва', '2026-01-01'::timestamptz),
            (102, 'РАЗГРУЗКА мебели', 'москва', '2026-01-02'::timestamptz),
            (103, 'Помощь на складе', 'Казань', '2026-01-03'::timestamptz),
            (104, 'Отменённая разгрузка', 'Москва', '2026-01-04'::timestamptz),
            (105, 'В работе', 'Москва', '2026-01-05'::timestamptz),
            (106, 'Сданная работа', 'Москва', '2026-01-06'::timestamptz),
            (107, 'Завершённая работа', 'Москва', '2026-01-07'::timestamptz),
            (108, 'Скидка 100%_тест', 'Москва', '2026-01-02'::timestamptz)
        ) AS data(n, title, city, created);
        INSERT INTO applications (gig_id, worker_id, status, comment)
        SELECT g.id, u.id, CASE WHEN g.title = 'Разгрузка коробок' THEN 'pending'
                              WHEN u.name = 'Worker' THEN 'selected' ELSE 'withdrawn' END,
            CASE WHEN u.name = 'Worker' THEN 'my-comment' ELSE 'other-private-comment' END
        FROM gigs g CROSS JOIN users u WHERE g.title IN ('Разгрузка коробок', 'В работе', 'Сданная работа', 'Завершённая работа')
            AND u.role = 'worker';
        UPDATE gigs SET status = 'cancelled', cancelled_at = now() WHERE title = 'Отменённая разгрузка';
        UPDATE gigs SET status = 'in_progress', selected_worker_id = '00000000-0000-0000-0000-000000000003' WHERE title = 'В работе';
        UPDATE gigs SET status = 'awaiting_confirmation', selected_worker_id = '00000000-0000-0000-0000-000000000003',
            submitted_at = now() WHERE title = 'Сданная работа';
        UPDATE gigs SET status = 'completed', selected_worker_id = '00000000-0000-0000-0000-000000000003',
            submitted_at = now(), completed_at = now() WHERE title = 'Завершённая работа';
    `)
	if err != nil {
		t.Fatal(err)
	}
	id := func(n int) string { return fmt.Sprintf("00000000-0000-0000-0000-%012d", n) }
	var cookies []*http.Cookie
	for n := 1; n <= 4; n++ {
		token := rand.Text()
		hash := sha256.Sum256([]byte(token))
		if _, err := pool.Exec(ctx, "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')", hash[:], id(n)); err != nil {
			t.Fatal(err)
		}
		cookies = append(cookies, &http.Cookie{Name: "shifthelper_session", Value: token})
	}
	router := handler.NewRouter(zap.NewNop(), pool, "", "http://shifthelper.localhost")
	send := func(method, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
		base, query, _ := strings.Cut(path, "?")
		request := httptest.NewRequest(method, "http://shifthelper.localhost"+base, nil).WithContext(ctx)
		request.URL.RawQuery = query
		request.Header.Set("Origin", "http://shifthelper.localhost")
		if cookie != nil {
			request.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	expect := func(response *httptest.ResponseRecorder, status int) {
		t.Helper()
		if response.Code != status {
			t.Fatalf("expected %d, got %d", status, response.Code)
		}
		if strings.Contains(response.Body.String(), "email") || strings.Contains(response.Body.String(), "password") || strings.Contains(response.Body.String(), "token_hash") {
			t.Fatal("public data exposes private fields")
		}
	}
	for _, tc := range []struct {
		query string
		total int64
		ids   []int
	}{
		{"", 4, []int{103, 108, 102, 101}},
		{"?q=" + url.QueryEscape("разгруз"), 2, []int{102, 101}},
		{"?city=" + url.QueryEscape(" МОСКВА "), 3, []int{108, 102, 101}},
		{"?q=" + url.QueryEscape("разгруз") + "&city=" + url.QueryEscape("Казань"), 0, []int{}},
		{"?q=" + url.QueryEscape("разгруз") + "&city=" + url.QueryEscape("Москва") + "&pageSize=1&page=2", 2, []int{101}},
		{"?pageSize=2&page=2", 4, []int{102, 101}},
		{"?pageSize=2&page=3", 4, []int{}},
		{"?pageSize=100&page=2147483647", 4, []int{}},
		{"?q=%25", 1, []int{108}}, {"?q=_", 1, []int{108}},
		{"?q=" + url.QueryEscape("%' OR 1=1 --"), 0, []int{}},
		{"?q=+++&city=+++", 4, []int{103, 108, 102, 101}},
	} {
		response := send("GET", "/api/v1/gigs"+tc.query, nil)
		expect(response, 200)
		var page gigs.GigPage
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil || page.Total != tc.total || page.Items == nil || len(page.Items) != len(tc.ids) {
			t.Fatalf("incorrect catalog result for %q", tc.query)
		}
		for i, item := range page.Items {
			if item.ID != id(tc.ids[i]) || item.Status != "open" || item.Customer.CompletedGigsCount != 1 || item.SelectedWorker != nil {
				t.Fatal("incorrect ordering, status or public customer")
			}
		}
	}
	for _, query := range []string{
		"?page=0", "?page=-1", "?page=1.5", "?page=2147483648", "?page=", "?pageSize=101", "?pageSize=0", "?pageSize=bad",
		"?status=completed", "?q=a&q=b", "?page=1&page=2", "?q=%ZZ", "?q=%FF", "?city=%00", "?q=a;b",
		"?q=" + url.QueryEscape(strings.Repeat("я", 151)), "?city=" + url.QueryEscape(strings.Repeat("я", 101)),
	} {
		expect(send("GET", "/api/v1/gigs"+query, nil), 400)
	}
	path := "/api/v1/gigs/" + id(101)
	response := send("GET", path, nil)
	expect(response, 200)
	var gig gigs.Gig
	if err := json.Unmarshal(response.Body.Bytes(), &gig); err != nil || gig.Description != "Full description" || gig.Requirements != "Conditions" ||
		gig.Address != "Example 1" || gig.PendingApplicationsCount != 2 || gig.MyApplication != nil || gig.SelectedWorker != nil {
		t.Fatal("incorrect public gig details")
	}
	response = send("GET", path, cookies[2])
	expect(response, 200)
	if err := json.Unmarshal(response.Body.Bytes(), &gig); err != nil || gig.MyApplication == nil || gig.MyApplication.Worker.ID != id(3) ||
		gig.MyApplication.Comment != "my-comment" || strings.Contains(response.Body.String(), "other-private-comment") {
		t.Fatal("own application is incorrect or another application was exposed")
	}
	for _, n := range []int{104, 105, 106, 107} {
		closed := "/api/v1/gigs/" + id(n)
		expect(send("GET", closed, nil), 404)
		expect(send("GET", closed, cookies[1]), 404)
		expect(send("GET", closed, cookies[0]), 200)
		if n != 104 {
			for _, cookie := range cookies[2:] {
				response = send("GET", closed, cookie)
				expect(response, 200)
				if err := json.Unmarshal(response.Body.Bytes(), &gig); err != nil || gig.SelectedWorker == nil || gig.SelectedWorker.ID != id(3) || gig.SelectedWorker.CompletedGigsCount != 1 {
					t.Fatal("incorrect selected worker")
				}
			}
		}
	}
	expect(send("GET", "/api/v1/gigs/bad", nil), 400)
	expect(send("GET", "/api/v1/gigs/"+id(999), nil), 404)
	expect(send("GET", path+"?userId="+id(1), nil), 400)
	forged := &http.Cookie{Name: "shifthelper_session", Value: "forged"}
	expect(send("GET", path, forged), 200)
	expect(send("GET", "/api/v1/gigs/"+id(107), forged), 404)
	hash := sha256.Sum256([]byte(cookies[3].Value))
	if _, err := pool.Exec(ctx, "UPDATE sessions SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE token_hash = $1", hash[:]); err != nil {
		t.Fatal(err)
	}
	expect(send("GET", path, cookies[3]), 200)
	expect(send("GET", "/api/v1/gigs/"+id(107), cookies[3]), 404)
	expect(send("POST", path+"/cancel", cookies[0]), 200)
	response = send("GET", "/api/v1/gigs", nil)
	expect(response, 200)
	var page gigs.GigPage
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil || page.Total != 3 || slices.ContainsFunc(page.Items, func(item gigs.GigSummary) bool { return item.ID == id(101) }) {
		t.Fatal("catalog did not reflect cancellation")
	}
	expect(send("GET", path, nil), 404)
	response = send("GET", path, cookies[2])
	expect(response, 200)
	if err := json.Unmarshal(response.Body.Bytes(), &gig); err != nil || gig.MyApplication == nil || gig.MyApplication.Status != "rejected" || gig.PendingApplicationsCount != 0 {
		t.Fatal("participant history did not reflect cancellation")
	}
}
