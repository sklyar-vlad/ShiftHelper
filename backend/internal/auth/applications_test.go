package auth_test

import (
	"crypto/rand"
	"crypto/sha256"
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
	"go.uber.org/zap"
)

func TestApplications(t *testing.T) {
	ctx, pool := testDatabase(t)
	_, err := pool.Exec(ctx, `
        INSERT INTO users (id, email, password_hash, role, name, bio) VALUES
        ('00000000-0000-0000-0000-000000000001', 'owner@example.test', 'test-hash', 'customer', 'Owner', ''),
        ('00000000-0000-0000-0000-000000000002', 'other@example.test', 'test-hash', 'customer', 'Other', ''),
        ('00000000-0000-0000-0000-000000000003', 'worker@example.test', 'test-hash', 'worker', 'Worker', 'Experienced'),
        ('00000000-0000-0000-0000-000000000004', 'worker2@example.test', 'test-hash', 'worker', 'Worker 2', '');
        INSERT INTO gigs (id, customer_id, title, description, city, address, starts_at, ends_at, amount_kopecks)
        SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
            '00000000-0000-0000-0000-000000000001', 'Work', 'Conditions', 'Moscow', 'Example',
            now() + interval '1 day', now() + interval '2 days', 10000 FROM generate_series(101, 107) n;
        INSERT INTO applications (gig_id, worker_id, status) VALUES
            ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000003', 'selected');
        UPDATE gigs SET status = 'completed', selected_worker_id = '00000000-0000-0000-0000-000000000003',
            submitted_at = now(), completed_at = now() WHERE id = '00000000-0000-0000-0000-000000000107';
        UPDATE gigs SET status = 'cancelled', cancelled_at = now() WHERE id = '00000000-0000-0000-0000-000000000103';
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
			t.Fatalf("expected %d, got %d", status, response.Code)
		}
		if code != "" {
			var body struct{ Error struct{ Code string } }
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Error.Code != code {
				t.Fatalf("expected error %s", code)
			}
		}
		if strings.Contains(response.Body.String(), "email") || strings.Contains(response.Body.String(), "password") || strings.Contains(response.Body.String(), "token_hash") {
			t.Fatal("application exposes private account fields")
		}
	}
	path := "/api/v1/gigs/" + id(101) + "/applications"
	expect(send("POST", path, "{}", nil), 401, "UNAUTHORIZED")
	expect(send("POST", path, "{}", cookies[0]), 403, "FORBIDDEN")
	expect(send("GET", path, "", nil), 401, "UNAUTHORIZED")
	expect(send("GET", path, "", cookies[2]), 403, "FORBIDDEN")
	expect(send("GET", path, "", cookies[1]), 404, "NOT_FOUND")
	for _, invalid := range []string{"", `null`, `[]`, `{} {}`, `{"comment":null}`, `{"comment":1}`, `{"comment":"\u0000"}`,
		`{"workerId":"` + id(4) + `"}`, `{"comment":"` + strings.Repeat("я", 1001) + `"}`} {
		expect(send("POST", path, invalid, cookies[2]), 400, "VALIDATION_ERROR")
	}
	response := send("GET", path, "", cookies[0])
	expect(response, 200, "")
	var page gigs.ApplicationPage
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil || page.Total != 0 || page.Items == nil || page.Page != 1 || page.PageSize != 20 {
		t.Fatal("invalid requests created an application or empty page is incorrect")
	}
	response = send("POST", path, `{"comment":"  Готов помочь  "}`, cookies[2])
	expect(response, 201, "")
	var application gigs.Application
	if err := json.Unmarshal(response.Body.Bytes(), &application); err != nil || application.ID == "" || application.GigID != id(101) ||
		application.Comment != "Готов помочь" || application.Status != "pending" || application.Worker.ID != id(3) ||
		application.Worker.Bio != "Experienced" || application.Worker.CompletedGigsCount != 1 {
		t.Fatal("incorrect saved application")
	}
	expect(send("POST", path, "{}", cookies[2]), 409, "ALREADY_APPLIED")
	response = send("POST", path, "{}", cookies[3])
	expect(response, 201, "")
	var second gigs.Application
	if err := json.Unmarshal(response.Body.Bytes(), &second); err != nil || second.Comment != "" {
		t.Fatal("missing comment did not default to an empty string")
	}
	if _, err := pool.Exec(ctx, "UPDATE applications SET created_at = '2026-01-01' WHERE gig_id = $1", id(101)); err != nil {
		t.Fatal(err)
	}
	wantIDs := []string{application.ID, second.ID}
	slices.Sort(wantIDs)
	slices.Reverse(wantIDs)
	for i := range 2 {
		response = send("GET", path+fmt.Sprintf("?pageSize=1&page=%d", i+1), "", cookies[0])
		expect(response, 200, "")
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].ID != wantIDs[i] {
			t.Fatal("application pagination or stable sorting is incorrect")
		}
	}
	for _, query := range []string{"?status=bad", "?status=", "?page=0", "?pageSize=101", "?status=pending&status=pending", "?workerId=" + id(3)} {
		expect(send("GET", path+query, "", cookies[0]), 400, "VALIDATION_ERROR")
	}
	response = send("GET", path+"?page=3&pageSize=1", "", cookies[0])
	expect(response, 200, "")
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil || page.Total != 2 || page.Items == nil || len(page.Items) != 0 {
		t.Fatal("empty application page is incorrect")
	}
	withdraw := path + "/" + application.ID + "/withdraw"
	expect(send("POST", withdraw, "", nil), 401, "UNAUTHORIZED")
	expect(send("POST", withdraw, "", cookies[0]), 403, "FORBIDDEN")
	expect(send("POST", withdraw, "", cookies[3]), 404, "NOT_FOUND")
	expect(send("POST", "/api/v1/gigs/"+id(102)+"/applications/"+application.ID+"/withdraw", "", cookies[2]), 404, "NOT_FOUND")
	expect(send("POST", path+"/bad/withdraw", "", cookies[2]), 400, "VALIDATION_ERROR")
	expect(send("POST", "/api/v1/gigs/bad/applications", "{}", cookies[2]), 400, "VALIDATION_ERROR")
	expect(send("POST", "/api/v1/gigs/"+id(999)+"/applications", "{}", cookies[2]), 404, "NOT_FOUND")
	expect(send("POST", "/api/v1/gigs/"+id(103)+"/applications", "{}", cookies[2]), 404, "NOT_FOUND")
	response = send("POST", withdraw, "", cookies[2])
	expect(response, 200, "")
	var withdrawn gigs.Application
	if err := json.Unmarshal(response.Body.Bytes(), &withdrawn); err != nil || withdrawn.Status != "withdrawn" {
		t.Fatal("application was not withdrawn")
	}
	expect(send("POST", withdraw, "", cookies[2]), 409, "STATE_CONFLICT")
	expect(send("POST", path, "{}", cookies[2]), 409, "ALREADY_APPLIED")
	var updated time.Time
	if err := pool.QueryRow(ctx, "SELECT updated_at FROM applications WHERE id = $1", application.ID).Scan(&updated); err != nil || !updated.Equal(withdrawn.UpdatedAt) {
		t.Fatal("repeated withdrawal changed history")
	}
	response = send("GET", path+"?status=withdrawn", "", cookies[0])
	expect(response, 200, "")
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil || page.Total != 1 || page.Items[0].ID != application.ID {
		t.Fatal("status filter is incorrect")
	}
	response = send("GET", "/api/v1/gigs/"+id(101), "", cookies[2])
	expect(response, 200, "")
	var gig gigs.Gig
	if err := json.Unmarshal(response.Body.Bytes(), &gig); err != nil || gig.MyApplication == nil || gig.MyApplication.ID != application.ID ||
		gig.MyApplication.Status != "withdrawn" || gig.PendingApplicationsCount != 1 {
		t.Fatal("own application or pending count is incorrect")
	}
	if _, err := pool.Exec(ctx, "UPDATE applications SET status = 'selected' WHERE id = $1", second.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE gigs SET status = 'in_progress', selected_worker_id = $1 WHERE id = $2", id(4), id(101)); err != nil {
		t.Fatal(err)
	}
	expect(send("POST", path+"/"+second.ID+"/withdraw", "", cookies[3]), 409, "STATE_CONFLICT")
	response = send("GET", path+"?status=selected", "", cookies[0])
	expect(response, 200, "")
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil || page.Total != 1 || page.Items[0].ID != second.ID {
		t.Fatal("owner cannot read applications after selection")
	}
	response = send("POST", "/api/v1/gigs/"+id(102)+"/applications", "{}", cookies[2])
	expect(response, 201, "")
	var rejected gigs.Application
	if err := json.Unmarshal(response.Body.Bytes(), &rejected); err != nil {
		t.Fatal(err)
	}
	expect(send("POST", "/api/v1/gigs/"+id(102)+"/cancel", "", cookies[0]), 200, "")
	expect(send("POST", "/api/v1/gigs/"+id(102)+"/applications/"+rejected.ID+"/withdraw", "", cookies[2]), 409, "STATE_CONFLICT")
	expect(send("POST", "/api/v1/gigs/"+id(102)+"/applications", "{}", cookies[2]), 409, "ALREADY_APPLIED")
	expect(send("POST", "/api/v1/gigs/"+id(102)+"/applications", "{}", cookies[3]), 404, "NOT_FOUND")
	concurrentPath := "/api/v1/gigs/" + id(105) + "/applications"
	results := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		go func() { results <- send("POST", concurrentPath, "{}", cookies[2]) }()
	}
	codes := map[int]int{}
	var concurrent gigs.Application
	for range 2 {
		result := <-results
		codes[result.Code]++
		if result.Code == 201 {
			if err := json.Unmarshal(result.Body.Bytes(), &concurrent); err != nil {
				t.Fatal(err)
			}
		}
	}
	if codes[201] != 1 || codes[409] != 1 {
		t.Fatal("concurrent requests created duplicate applications")
	}
	for range 2 {
		go func() { results <- send("POST", concurrentPath+"/"+concurrent.ID+"/withdraw", "", cookies[2]) }()
	}
	codes = map[int]int{}
	for range 2 {
		codes[(<-results).Code]++
	}
	if codes[200] != 1 || codes[409] != 1 {
		t.Fatal("concurrent withdrawal did not reject a repeated transition")
	}
	go func() { results <- send("POST", "/api/v1/gigs/"+id(104)+"/applications", "{}", cookies[2]) }()
	go func() { results <- send("POST", "/api/v1/gigs/"+id(104)+"/cancel", "", cookies[0]) }()
	codes = map[int]int{}
	for range 2 {
		codes[(<-results).Code]++
	}
	if codes[200] != 1 || codes[201]+codes[404] != 1 {
		t.Fatal("application and cancellation race returned unexpected results")
	}
	var pending int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM applications WHERE gig_id = $1 AND status = 'pending'", id(104)).Scan(&pending); err != nil || pending != 0 {
		t.Fatal("cancelled gig retained a pending application")
	}
	expect(send("POST", "/api/v1/gigs/"+id(106)+"/applications", `{"comment":"`+strings.Repeat("😀", 1000)+`"}`, cookies[2]), 201, "")
}
