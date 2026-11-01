package auth_test

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/sklyar-vlad/ShiftHelper/backend/internal/gigs"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"go.uber.org/zap"
)

func TestPersonalLists(t *testing.T) {
	ctx, pool := testDatabase(t)
	id := func(n int) string { return fmt.Sprintf("00000000-0000-0000-0000-%012d", n) }
	_, err := pool.Exec(ctx, `
        INSERT INTO users (id, email, password_hash, role, name, bio)
        SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
            n || '@example.test', 'test-hash', CASE WHEN n < 3 THEN 'customer' ELSE 'worker' END,
            'User ' || n, 'Public bio' FROM generate_series(1, 5) n;
        INSERT INTO gigs (id, customer_id, title, description, city, address, starts_at, ends_at, amount_kopecks)
        SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
            CASE WHEN n = 109 THEN '00000000-0000-0000-0000-000000000002' ELSE '00000000-0000-0000-0000-000000000001' END::uuid,
            'Work ' || n, 'Conditions', 'Moscow', 'Example', now() + interval '1 day', now() + interval '2 days', 10000
        FROM generate_series(101, 109) n;
        INSERT INTO applications (id, gig_id, worker_id, comment, status)
        SELECT ('00000000-0000-0000-0000-' || lpad((g * 10 + w)::text, 12, '0'))::uuid,
            ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
            ('00000000-0000-0000-0000-' || lpad(w::text, 12, '0'))::uuid, 'Comment ' || w,
            CASE WHEN g = 102 AND w = 3 THEN 'withdrawn'
                 WHEN g = 103 AND w = 3 OR g = 107 OR g = 108 AND w = 3 OR g IN (104,105,106) AND w = 4 THEN 'rejected'
                 WHEN g IN (104,105,106) AND w = 3 OR g = 108 AND w = 4 THEN 'selected' ELSE 'pending' END
        FROM generate_series(101, 109) g CROSS JOIN generate_series(3, 4) w WHERE g <> 109 OR w = 4;
        UPDATE gigs SET status = CASE WHEN id = '00000000-0000-0000-0000-000000000105' THEN 'awaiting_confirmation'
            WHEN id = '00000000-0000-0000-0000-000000000106' THEN 'completed' ELSE 'in_progress' END,
            selected_worker_id = CASE WHEN id = '00000000-0000-0000-0000-000000000108'
                THEN '00000000-0000-0000-0000-000000000004' ELSE '00000000-0000-0000-0000-000000000003' END::uuid,
            submitted_at = CASE WHEN id IN ('00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000106') THEN now() END,
            completed_at = CASE WHEN id = '00000000-0000-0000-0000-000000000106' THEN now() END
            WHERE id IN ('00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000108');
        UPDATE gigs SET status = 'cancelled', cancelled_at = now() WHERE id = '00000000-0000-0000-0000-000000000107';
    `)
	if err != nil {
		t.Fatal(err)
	}
	cookies := make([]*http.Cookie, 5)
	for n := 1; n <= 5; n++ {
		token := rand.Text()
		hash := sha256.Sum256([]byte(token))
		if _, err := pool.Exec(ctx, "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,now()+interval '7 days')", hash[:], id(n)); err != nil {
			t.Fatal(err)
		}
		cookies[n-1] = &http.Cookie{Name: "shifthelper_session", Value: token}
	}
	router := handler.NewRouter(zap.NewNop(), pool, "", "http://shifthelper.localhost")
	send := func(method, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, "http://shifthelper.localhost"+path, strings.NewReader("{}")).WithContext(ctx)
		request.Header.Set("Origin", "http://shifthelper.localhost")
		request.Header.Set("Content-Type", "application/json")
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
			t.Fatalf("expected %d, got %d: %s", status, response.Code, response.Body.String())
		}
	}
	for _, path := range []string{"/api/v1/me/gigs", "/api/v1/me/applications"} {
		expect(send("GET", path, nil), 401)
		expect(send("GET", path, &http.Cookie{Name: "shifthelper_session", Value: "expired"}), 401)
		for _, query := range []string{"scope=", "scope=wrong", "scope=all&scope=active", "page=0", "page=2147483648", "pageSize=101", "page=1&page=2", "userId=" + id(1), "workerId=" + id(4), "customerId=" + id(2)} {
			expect(send("GET", path+"?"+query, cookies[2]), 400)
		}
	}
	expect(send("GET", "/api/v1/me/applications", cookies[0]), 403)
	checkGigs := func(n int, query string, total int64, want ...int) gigs.GigPage {
		t.Helper()
		response := send("GET", "/api/v1/me/gigs"+query, cookies[n-1])
		expect(response, 200)
		var page gigs.GigPage
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil || page.Total != total || page.Items == nil {
			t.Fatal("incorrect gig page")
		}
		got, expected := []string{}, []string{}
		for _, item := range page.Items {
			got = append(got, item.ID)
			if n < 3 && item.Customer.ID != id(n) || n >= 3 && (item.SelectedWorker == nil || item.SelectedWorker.ID != id(n)) {
				t.Fatal("another user's gig leaked")
			}
		}
		for _, g := range want {
			expected = append(expected, id(g))
		}
		if !reflect.DeepEqual(got, expected) {
			t.Fatalf("gig ids: got %v, want %v", got, expected)
		}
		return page
	}
	checkApps := func(query string, total int64, want ...int) gigs.MyApplicationPage {
		t.Helper()
		response := send("GET", "/api/v1/me/applications"+query, cookies[2])
		expect(response, 200)
		for _, private := range []string{"email", "password", "token_hash", "Comment 4"} {
			if strings.Contains(response.Body.String(), private) {
				t.Fatal("private account fields or another application leaked")
			}
		}
		var page gigs.MyApplicationPage
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil || page.Total != total || page.Items == nil {
			t.Fatal("incorrect application page")
		}
		got, expected := []string{}, []string{}
		for _, item := range page.Items {
			got = append(got, item.Gig.ID)
			if item.Application.Worker.ID != id(3) || item.Application.GigID != item.Gig.ID {
				t.Fatal("incorrect application owner or linked gig")
			}
			expect(send("GET", "/api/v1/gigs/"+item.Gig.ID, cookies[2]), 200)
		}
		for _, g := range want {
			expected = append(expected, id(g))
		}
		if !reflect.DeepEqual(got, expected) {
			t.Fatalf("application gigs: got %v, want %v", got, expected)
		}
		return page
	}
	page := checkGigs(1, "", 8, 108, 107, 106, 105, 104, 103, 102, 101)
	if page.Page != 1 || page.PageSize != 20 || page.Items[7].PendingApplicationsCount != 2 {
		t.Fatal("incorrect defaults or pending count")
	}
	checkGigs(1, "?scope=active", 6, 108, 105, 104, 103, 102, 101)
	checkGigs(1, "?scope=history", 2, 107, 106)
	checkGigs(2, "", 1, 109)
	checkGigs(3, "", 3, 106, 105, 104)
	checkGigs(3, "?scope=active", 2, 105, 104)
	checkGigs(3, "?scope=history", 1, 106)
	checkGigs(4, "", 1, 108)
	checkGigs(5, "", 0)
	page = checkGigs(1, "?page=2&pageSize=3", 8, 105, 104, 103)
	if page.Page != 2 || page.PageSize != 3 {
		t.Fatal("incorrect pagination metadata")
	}
	checkGigs(1, "?page=2147483647&pageSize=100", 8)
	checkApps("", 8, 108, 107, 106, 105, 104, 103, 102, 101)
	checkApps("?scope=active", 3, 105, 104, 101)
	checkApps("?scope=history", 5, 108, 107, 106, 103, 102)
	apps := checkApps("?page=2&pageSize=3", 8, 105, 104, 103)
	if apps.Page != 2 || apps.PageSize != 3 {
		t.Fatal("incorrect application pagination")
	}
	checkApps("?page=2147483647&pageSize=100", 8)
	response := send("GET", "/api/v1/me/applications", cookies[4])
	expect(response, 200)
	if err := json.Unmarshal(response.Body.Bytes(), &apps); err != nil || apps.Total != 0 || apps.Items == nil || len(apps.Items) != 0 {
		t.Fatal("empty application list is not an array")
	}

	base := "/api/v1/gigs/" + id(101)
	expect(send("POST", base+"/applications/"+id(1013)+"/select", cookies[0]), 200)
	checkGigs(3, "?scope=active", 3, 105, 104, 101)
	page = checkGigs(1, "", 8, 108, 107, 106, 105, 104, 103, 102, 101)
	if page.Items[7].Status != "in_progress" || page.Items[7].PendingApplicationsCount != 0 || page.Items[7].SelectedWorker == nil || page.Items[7].SelectedWorker.ID != id(3) {
		t.Fatal("selection not reflected in personal list")
	}
	checkApps("?scope=active", 3, 105, 104, 101)
	expect(send("POST", base+"/submit", cookies[2]), 200)
	if checkApps("?scope=active", 3, 105, 104, 101).Items[2].Gig.Status != "awaiting_confirmation" {
		t.Fatal("submission not reflected in linked gig")
	}
	expect(send("POST", base+"/confirm", cookies[0]), 200)
	checkGigs(1, "?scope=history", 3, 107, 106, 101)
	checkGigs(3, "?scope=history", 2, 106, 101)
	checkApps("?scope=history", 6, 108, 107, 106, 103, 102, 101)
	checkApps("?scope=active", 2, 105, 104)
	expect(send("POST", "/api/v1/gigs/"+id(102)+"/cancel", cookies[0]), 200)
	checkGigs(1, "?scope=history", 4, 107, 106, 102, 101)
	if checkApps("?scope=history", 6, 108, 107, 106, 103, 102, 101).Items[4].Gig.Status != "cancelled" {
		t.Fatal("cancellation not reflected in application history")
	}
	expect(send("POST", "/api/v1/gigs/"+id(109)+"/applications", cookies[2]), 201)
	checkApps("?scope=active", 3, 109, 105, 104)
	checkGigs(3, "", 4, 106, 105, 104, 101)
}
