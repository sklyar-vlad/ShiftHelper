package auth_test

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"reflect"
	"testing"

	"github.com/sklyar-vlad/ShiftHelper/backend/internal/gigs"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"go.uber.org/zap"
)

func TestCatalogFilters(t *testing.T) {
	ctx, pool := testDatabase(t)
	_, err := pool.Exec(ctx, `
 INSERT INTO users (id, email, password_hash, role, name)
 VALUES ('00000000-0000-0000-0000-000000000001', 'filters@example.test', 'test-hash', 'customer', 'Owner');
 INSERT INTO gigs (id, customer_id, title, description, city, address, category, starts_at, ends_at, amount_kopecks, created_at)
 SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
 '00000000-0000-0000-0000-000000000001', 'Помощь ' || n, 'Description', city, 'Address', category,
 '2030-01-01 10:00:00+00'::timestamptz + start_hour * interval '1 hour',
 '2030-01-01 10:00:00+00'::timestamptz + start_hour * interval '1 hour' + seconds * interval '1 second',
 amount, '2026-01-01'::timestamptz + created_day * interval '1 day'
 FROM (VALUES
 (101, 'moving', 'Москва', 0, 7200, 100::bigint, 0),
 (102, 'moving', 'Москва', 0, 7201, 200::bigint, 0),
 (103, 'moving', 'Москва', 1, 14400, 200::bigint, 1),
 (104, 'repair', 'Москва', 2, 28800, 300::bigint, 2),
 (105, 'moving', 'Казань', 3, 3600, 10000000000::bigint, 2),
 (106, 'moving', 'Москва', 0, 60, 100::bigint, 3)
 ) AS data(n, category, city, start_hour, seconds, amount, created_day);
 UPDATE gigs SET status = 'cancelled', cancelled_at = now() WHERE title = 'Помощь 106';`)
	if err != nil {
		t.Fatal(err)
	}
	router := handler.NewRouter(zap.NewNop(), pool, "", "http://shifthelper.localhost")
	send := func(query string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("GET", "http://shifthelper.localhost/api/v1/gigs?"+query, nil).WithContext(ctx)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	for _, tc := range []struct {
		query string
		total int64
		ids   []int
	}{
		{"", 5, []int{105, 104, 103, 102, 101}},
		{"sort=newest", 5, []int{105, 104, 103, 102, 101}},
		{"sort=nearest", 5, []int{101, 102, 103, 104, 105}},
		{"sort=amount_asc", 5, []int{101, 102, 103, 104, 105}},
		{"sort=amount_desc", 5, []int{105, 104, 103, 102, 101}},
		{"category=moving", 4, []int{105, 103, 102, 101}},
		{"minAmountKopecks=200&maxAmountKopecks=200", 2, []int{103, 102}},
		{"minAmountKopecks=10000000000", 1, []int{105}},
		{"maxAmountKopecks=0", 0, []int{}},
		{"minAmountKopecks=0&maxAmountKopecks=10000000000", 5, []int{105, 104, 103, 102, 101}},
		{"maxDurationMinutes=120", 2, []int{105, 101}},
		{"maxDurationMinutes=240", 4, []int{105, 103, 102, 101}},
		{"maxDurationMinutes=480", 5, []int{105, 104, 103, 102, 101}},
		{"maxDurationMinutes=2147483647", 5, []int{105, 104, 103, 102, 101}},
		{"startsFrom=2030-01-01T13:00:00%2B03:00&startsBefore=2030-01-01T11:00:00Z", 2, []int{102, 101}},
		{"startsFrom=2030-01-01T11:00:00Z", 3, []int{105, 104, 103}},
		{"startsBefore=2030-01-01T10:00:00Z", 0, []int{}},
		{"category=moving&q=" + url.QueryEscape("помощь") + "&city=" + url.QueryEscape(" МОСКВА ") + "&minAmountKopecks=100&maxAmountKopecks=200&startsFrom=2030-01-01T10:00:00Z&startsBefore=2030-01-01T12:00:00Z&maxDurationMinutes=240&sort=nearest&pageSize=2&page=2", 3, []int{103}},
		{"category=repair&minAmountKopecks=301", 0, []int{}},
		{"category=moving&page=3&pageSize=2", 4, []int{}},
		{"category=&minAmountKopecks=&maxAmountKopecks=&startsFrom=&startsBefore=&maxDurationMinutes=&sort=", 5, []int{105, 104, 103, 102, 101}},
	} {
		t.Run(tc.query, func(t *testing.T) {
			res := send(tc.query)
			if res.Code != 200 {
				t.Fatalf("status %d: %s", res.Code, res.Body.String())
			}
			var page gigs.GigPage
			if err := json.Unmarshal(res.Body.Bytes(), &page); err != nil {
				t.Fatal(err)
			}
			ids := make([]int, 0, len(page.Items))
			for _, gig := range page.Items {
				var n int
				if _, err := fmt.Sscanf(gig.ID, "00000000-0000-0000-0000-%d", &n); err != nil {
					t.Fatal(err)
				}
				ids = append(ids, n)
			}
			if page.Total != tc.total || page.Items == nil || !reflect.DeepEqual(ids, tc.ids) {
				t.Fatalf("total=%d ids=%v; want total=%d ids=%v", page.Total, ids, tc.total, tc.ids)
			}
		})
	}
	for _, sort := range []string{"newest", "nearest", "amount_asc", "amount_desc"} {
		t.Run("pages/"+sort, func(t *testing.T) {
			var whole gigs.GigPage
			if err := json.Unmarshal(send("sort="+sort).Body.Bytes(), &whole); err != nil {
				t.Fatal(err)
			}
			var joined []gigs.GigSummary
			for page := 1; page <= 3; page++ {
				res := send(fmt.Sprintf("sort=%s&pageSize=2&page=%d", sort, page))
				var part gigs.GigPage
				if res.Code != 200 {
					t.Fatalf("status %d", res.Code)
				}
				if err := json.Unmarshal(res.Body.Bytes(), &part); err != nil {
					t.Fatal(err)
				}
				if part.Total != 5 || part.Page != page || part.PageSize != 2 {
					t.Fatalf("incorrect pagination: %+v", part)
				}
				joined = append(joined, part.Items...)
			}
			if !reflect.DeepEqual(joined, whole.Items) {
				t.Fatal("pages differ from the complete sorted result")
			}
		})
	}
	for _, query := range []string{
		"category=unknown", "category=%27%20OR%201=1--", "category=moving&category=repair", "sort=invalid", "sort=created_at%20DESC",
		"minAmountKopecks=-1", "maxAmountKopecks=-1", "minAmountKopecks=1.5", "maxAmountKopecks=NaN",
		"minAmountKopecks=10000000001", "maxAmountKopecks=10000000001", "minAmountKopecks=9223372036854775808", "minAmountKopecks=201&maxAmountKopecks=200",
		"maxDurationMinutes=0", "maxDurationMinutes=-1", "maxDurationMinutes=1.5", "maxDurationMinutes=2147483648", "maxDurationMinutes=9223372036854775808",
		"startsFrom=bad", "startsBefore=2030-01-01", "startsFrom=2030-01-01T10:00:00", "startsBefore=2030-02-30T10:00:00Z", "startsFrom=0000-01-01T00:00:00Z",
		"startsFrom=2030-01-01T11:00:00Z&startsBefore=2030-01-01T10:00:00Z", "startsFrom=2030-01-01T10:00:00Z&startsBefore=2030-01-01T10:00:00Z",
	} {
		t.Run("invalid/"+query, func(t *testing.T) {
			res := send(query)
			var result struct{ Error struct{ Code string } }
			if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if res.Code != 400 || result.Error.Code != "VALIDATION_ERROR" {
				t.Fatalf("status %d: %s", res.Code, res.Body.String())
			}
		})
	}
}
