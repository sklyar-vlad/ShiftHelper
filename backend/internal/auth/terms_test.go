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
	"sync"
	"testing"
	"time"

	"github.com/sklyar-vlad/ShiftHelper/backend/internal/gigs"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"go.uber.org/zap"
)

func TestGigTerms(t *testing.T) {
	ctx, pool := testDatabase(t)
	cookies := make([]*http.Cookie, 4)
	for i := range 4 {
		role := "worker"
		if i == 0 || i == 3 {
			role = "customer"
		}
		var id string
		if err := pool.QueryRow(ctx, `INSERT INTO users(email,password_hash,role,name) VALUES($1,'test',$2,'Name') RETURNING id::text`, fmt.Sprintf("terms%d@example.test", i), role).Scan(&id); err != nil {
			t.Fatal(err)
		}
		token := rand.Text()
		hash := sha256.Sum256([]byte(token))
		if _, err := pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')`, hash[:], id); err != nil {
			t.Fatal(err)
		}
		cookies[i] = &http.Cookie{Name: "shifthelper_session", Value: token}
	}
	router := handler.NewRouter(zap.NewNop(), pool, "", "http://shifthelper.localhost")
	send := func(method, path string, body map[string]any, actor int) *httptest.ResponseRecorder {
		var data []byte
		if body != nil {
			data, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, "http://shifthelper.localhost/api/v1"+path, strings.NewReader(string(data))).WithContext(ctx)
		req.Header.Set("Origin", "http://shifthelper.localhost")
		req.Header.Set("Content-Type", "application/json")
		if actor >= 0 {
			req.AddCookie(cookies[actor])
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	expect := func(r *httptest.ResponseRecorder, status int) {
		t.Helper()
		if r.Code != status {
			t.Fatalf("want %d got %d: %s", status, r.Code, r.Body.String())
		}
	}
	decode := func(r *httptest.ResponseRecorder, status int) gigs.Gig {
		t.Helper()
		expect(r, status)
		var gig gigs.Gig
		if err := json.Unmarshal(r.Body.Bytes(), &gig); err != nil {
			t.Fatal(err)
		}
		return gig
	}
	body := func(g gigs.Gig) map[string]any {
		return map[string]any{"termsVersion": g.TermsVersion, "title": g.Title, "description": g.Description, "requirements": g.Requirements, "city": g.City, "address": g.Address, "startsAt": g.StartsAt.Format(time.RFC3339Nano), "endsAt": g.EndsAt.Format(time.RFC3339Nano), "amountKopecks": g.AmountKopecks}
	}
	create := func() gigs.Gig {
		start := time.Now().UTC().Truncate(time.Microsecond).Add(24 * time.Hour)
		return decode(send("POST", "/gigs", map[string]any{"title": "Work", "description": "Details", "requirements": "", "city": "Москва", "address": "Address", "startsAt": start.Format(time.RFC3339Nano), "endsAt": start.Add(time.Hour).Format(time.RFC3339Nano), "amountKopecks": 150050}, 0), 201)
	}
	apply := func(g gigs.Gig, actor int) string {
		t.Helper()
		r := send("POST", "/gigs/"+g.ID+"/applications", map[string]any{"termsVersion": g.TermsVersion}, actor)
		expect(r, 201)
		var app gigs.Application
		if err := json.Unmarshal(r.Body.Bytes(), &app); err != nil {
			t.Fatal(err)
		}
		return app.ID
	}
	t.Run("open consent and access", func(t *testing.T) {
		g := create()
		path := "/gigs/" + g.ID
		for _, invalid := range []any{nil, 0, -1, 1.5, "1"} {
			expect(send("POST", path+"/applications", map[string]any{"termsVersion": invalid}, 1), 400)
		}
		b := body(g)
		b["description"] = "Revision 2"
		g = decode(send("PUT", path+"/terms", b, 0), 200)
		if g.TermsVersion != 2 {
			t.Fatal("version unchanged")
		}
		expect(send("POST", path+"/applications", map[string]any{}, 1), 409)
		app := apply(g, 1)
		old := g
		b = body(g)
		b["amountKopecks"] = 200099
		for _, actor := range []int{-1, 1, 3} {
			want := 403
			if actor == -1 {
				want = 401
			}
			expect(send("PUT", path+"/terms", b, actor), want)
		}
		g = decode(send("PUT", path+"/terms", b, 0), 200)
		if g.TermsVersion != 3 || g.AmountKopecks != 200099 {
			t.Fatal("edit lost data")
		}
		expect(send("PUT", path+"/terms", b, 0), 409)
		expect(send("POST", path+"/applications", map[string]any{"termsVersion": old.TermsVersion}, 2), 409)
		expect(send("POST", path+"/applications/"+app+"/select", nil, 0), 409)
		route := path + "/applications/" + app + "/confirm-terms"
		expect(send("POST", route, map[string]any{"termsVersion": old.TermsVersion}, 1), 409)
		expect(send("POST", route, map[string]any{"termsVersion": g.TermsVersion}, 2), 404)
		confirmed := decode(send("POST", route, map[string]any{"termsVersion": g.TermsVersion}, 1), 200)
		if confirmed.MyApplication == nil || confirmed.MyApplication.TermsVersion != 3 {
			t.Fatal("wrong consent")
		}
		expect(send("POST", route, map[string]any{"termsVersion": 3}, 1), 409)
		apply(g, 2)
		var count int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM applications WHERE gig_id=$1", g.ID).Scan(&count); err != nil || count != 2 {
			t.Fatal("applications replaced", err)
		}
		g = decode(send("POST", path+"/applications/"+app+"/select", nil, 0), 200)
		if g.Status != "in_progress" || g.AmountKopecks != 200099 {
			t.Fatal("selection lost conditions")
		}
	})
	t.Run("working decisions and submission", func(t *testing.T) {
		g := create()
		path := "/gigs/" + g.ID
		app := apply(g, 1)
		apply(g, 2)
		g = decode(send("POST", path+"/applications/"+app+"/select", nil, 0), 200)
		past := time.Now().UTC().Truncate(time.Microsecond).Add(-time.Hour)
		if _, err := pool.Exec(ctx, "UPDATE gigs SET starts_at=$2 WHERE id=$1", g.ID, past); err != nil {
			t.Fatal(err)
		}
		g = decode(send("GET", path, nil, 0), 200)
		for _, action := range []string{"reject", "withdraw", "accept"} {
			b := body(g)
			b["amountKopecks"] = 200099
			b["city"] = "Киров, Калужская область"
			proposed := decode(send("PUT", path+"/terms", b, 0), 200)
			if proposed.PendingChange == nil || !proposed.HasPendingChange || proposed.AmountKopecks != g.AmountKopecks {
				t.Fatal("proposal changed active conditions")
			}
			route := path + "/changes/" + proposed.PendingChange.ID
			expect(send("PUT", path+"/terms", b, 0), 409)
			for _, actor := range []int{-1, 2, 3} {
				if strings.Contains(send("GET", path, nil, actor).Body.String(), "pendingChange") {
					t.Fatal("proposal leaked")
				}
			}
			expect(send("POST", route+"/accept", nil, 0), 403)
			expect(send("POST", route+"/accept", nil, 2), 404)
			expect(send("POST", route+"/withdraw", nil, 1), 403)
			actor := 1
			if action == "withdraw" {
				actor = 0
			}
			result := decode(send("POST", route+"/"+action, nil, actor), 200)
			if result.PendingChange != nil || result.HasPendingChange {
				t.Fatal("proposal remains active")
			}
			if action == "accept" {
				if result.AmountKopecks != 200099 || result.TermsVersion != g.TermsVersion+1 || !result.StartsAt.Equal(past) {
					t.Fatal("accept lost dates or amount")
				}
			} else if result.AmountKopecks != g.AmountKopecks || result.TermsVersion != g.TermsVersion {
				t.Fatal("decline changed conditions")
			}
			expect(send("POST", route+"/"+action, nil, actor), 409)
			g = result
		}
		b := body(g)
		b["startsAt"] = past.Add(-time.Hour).Format(time.RFC3339Nano)
		expect(send("PUT", path+"/terms", b, 0), 400)
		for key, value := range map[string]any{"amountKopecks": 1.5, "customerId": "forged", "status": "completed", "selectedWorkerId": "forged"} {
			b = body(g)
			b[key] = value
			expect(send("PUT", path+"/terms", b, 0), 400)
		}
		b = body(g)
		b["description"] = "Later proposal"
		proposed := decode(send("PUT", path+"/terms", b, 0), 200)
		submitted := decode(send("POST", path+"/submit", nil, 1), 200)
		if submitted.PendingChange != nil || submitted.HasPendingChange {
			t.Fatal("submission did not expire proposal")
		}
		expect(send("POST", path+"/changes/"+proposed.PendingChange.ID+"/accept", nil, 1), 409)
		expect(send("PUT", path+"/terms", body(submitted), 0), 409)
		completed := decode(send("POST", path+"/confirm", nil, 0), 200)
		expect(send("PUT", path+"/terms", body(completed), 0), 409)
		cancelled := create()
		decode(send("POST", "/gigs/"+cancelled.ID+"/cancel", nil, 0), 200)
		expect(send("PUT", "/gigs/"+cancelled.ID+"/terms", body(cancelled), 0), 409)
	})
	t.Run("confirmed gig point", func(t *testing.T) {
		zero := map[string]any{"latitude": 0, "longitude": 0}
		geocoded := map[string]any{
			"latitude": 90, "longitude": -180, "source": "geoapify", "attribution": "OpenStreetMap contributors",
			"addressReference": map[string]any{"latitude": 89, "longitude": -179},
		}
		const zeroPoint = `{"latitude":0,"longitude":0,"source":"manual"}`
		const geoPoint = `{"latitude":90,"longitude":-180,"source":"geoapify","attribution":"OpenStreetMap contributors",
			"addressReference":{"latitude":89,"longitude":-179}}`
		assertPoint := func(raw json.RawMessage, want string) {
			t.Helper()
			var got, expected any
			if len(raw) != 0 {
				if err := json.Unmarshal(raw, &got); err != nil {
					t.Fatal(err)
				}
			}
			if err := json.Unmarshal([]byte(want), &expected); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, expected) {
				t.Fatalf("point = %s, want %s", raw, want)
			}
		}

		legacy := create()
		assertPoint(legacy.Point, "null")
		createBody := body(legacy)
		delete(createBody, "termsVersion")
		for _, bad := range []string{
			`{"latitude":0}`, `{"latitude":0,"longitude":null}`,
			`{"latitude":91,"longitude":0}`, `{"latitude":0,"longitude":-181}`,
			`{"latitude":1e999,"longitude":0}`, `{"latitude":"0","longitude":0}`,
			`{"latitude":0,"longitude":0,"source":"geoapify"}`,
			`{"latitude":0,"longitude":0,"unexpected":true}`,
			`{"latitude":0,"longitude":0,"addressReference":{"latitude":0,"longitude":0}}`,
			`{"latitude":0,"longitude":0,"source":"geoapify","attribution":"Geoapify","addressReference":{"latitude":91,"longitude":0}}`,
		} {
			createBody["point"] = json.RawMessage(bad)
			expect(send("POST", "/gigs", createBody, 0), 400)
		}
		createBody["point"] = zero
		g := decode(send("POST", "/gigs", createBody, 0), 201)
		path := "/gigs/" + g.ID
		assertPoint(g.Point, zeroPoint)
		assertPoint(decode(send("GET", path, nil, -1), 200).Point, zeroPoint)
		for _, listing := range []string{"/gigs", "/me/gigs"} {
			list := send("GET", listing, nil, 0)
			expect(list, 200)
			if strings.Contains(list.Body.String(), `"point"`) {
				t.Fatal("point exposed in a listing")
			}
		}
		before := g.TermsVersion
		g = decode(send("PUT", path+"/terms", body(g), 0), 200)
		assertPoint(g.Point, zeroPoint)
		if g.TermsVersion != before+1 {
			t.Fatal("open edit must advance the version")
		}
		b := body(g)
		b["address"] = "A different address"
		g = decode(send("PUT", path+"/terms", b, 0), 200)
		assertPoint(g.Point, "null")
		b = body(g)
		b["point"] = zero
		g = decode(send("PUT", path+"/terms", b, 0), 200)
		b = body(g)
		b["point"] = nil
		g = decode(send("PUT", path+"/terms", b, 0), 200)
		assertPoint(g.Point, "null")
		b = body(g)
		b["point"] = zero
		g = decode(send("PUT", path+"/terms", b, 0), 200)
		app := apply(g, 1)
		apply(g, 2)
		g = decode(send("POST", path+"/applications/"+app+"/select", nil, 0), 200)
		expect(send("GET", path, nil, -1), 404)
		for _, action := range []string{"reject", "withdraw", "accept"} {
			b := body(g)
			b["point"] = geocoded
			proposal := decode(send("PUT", path+"/terms", b, 0), 200)
			assertPoint(proposal.Point, zeroPoint)
			assertPoint(proposal.PendingChange.Terms.Point, geoPoint)
			assertPoint(decode(send("GET", path, nil, 1), 200).PendingChange.Terms.Point, geoPoint)
			other := decode(send("GET", path, nil, 2), 200)
			if other.PendingChange != nil {
				t.Fatal("proposal exposed to another candidate")
			}
			actor := 1
			if action == "withdraw" {
				actor = 0
			}
			res := decode(send("POST", path+"/changes/"+proposal.PendingChange.ID+"/"+action, nil, actor), 200)
			want := zeroPoint
			if action == "accept" {
				want = geoPoint
			}
			assertPoint(res.Point, want)
			g = res
		}
		for _, address := range []string{g.Address, "Legacy changed address"} {
			b = body(g)
			b["address"] = address
			proposal := decode(send("PUT", path+"/terms", b, 0), 200)
			want := geoPoint
			if address != g.Address {
				want = "null"
			}
			assertPoint(proposal.PendingChange.Terms.Point, want)
			g = decode(send("POST", path+"/changes/"+proposal.PendingChange.ID+"/accept", nil, 1), 200)
			assertPoint(g.Point, want)
		}
	})
	for _, mode := range []string{"edit-select", "edit-apply", "edit-edit", "accept-reject", "accept-withdraw", "accept-submit"} {
		t.Run(mode, func(t *testing.T) {
			g := create()
			path := "/gigs/" + g.ID
			app := apply(g, 1)
			b := body(g)
			b["amountKopecks"] = 200099
			first := func() *httptest.ResponseRecorder { return send("PUT", path+"/terms", b, 0) }
			var second func() *httptest.ResponseRecorder
			switch mode {
			case "edit-select":
				second = func() *httptest.ResponseRecorder { return send("POST", path+"/applications/"+app+"/select", nil, 0) }
			case "edit-apply":
				second = func() *httptest.ResponseRecorder {
					return send("POST", path+"/applications", map[string]any{"termsVersion": 1}, 2)
				}
			case "edit-edit":
				second = first
			default:
				g = decode(send("POST", path+"/applications/"+app+"/select", nil, 0), 200)
				b = body(g)
				b["amountKopecks"] = 200099
				p := decode(send("PUT", path+"/terms", b, 0), 200)
				route := path + "/changes/" + p.PendingChange.ID
				changeRoute := route
				first = func() *httptest.ResponseRecorder { return send("POST", changeRoute+"/accept", nil, 1) }
				action := strings.TrimPrefix(mode, "accept-")
				actor := 1
				if action == "withdraw" {
					actor = 0
				}
				if action == "submit" {
					route = path
				} else {
					route += "/" + action
				}
				if action == "submit" {
					route += "/submit"
				}
				second = func() *httptest.ResponseRecorder { return send("POST", route, nil, actor) }
			}
			results := make([]*httptest.ResponseRecorder, 2)
			var wg sync.WaitGroup
			start := make(chan struct{})
			for i, fn := range []func() *httptest.ResponseRecorder{first, second} {
				wg.Go(func() { <-start; results[i] = fn() })
			}
			close(start)
			wg.Wait()
			for _, r := range results {
				if r.Code != 200 && r.Code != 201 && r.Code != 409 {
					t.Fatal("unexpected race", r.Code, r.Body.String())
				}
			}
			final := decode(send("GET", path, nil, 0), 200)
			if mode == "edit-select" && final.Status == "in_progress" && final.AmountKopecks != 150050 {
				t.Fatal("unconfirmed conditions selected")
			}
			if mode == "edit-edit" && results[0].Code == results[1].Code {
				t.Fatal("both stale edits succeeded")
			}
			if strings.HasPrefix(mode, "accept-") && final.HasPendingChange {
				t.Fatal("pending change after decisions")
			}
			if mode == "accept-submit" && final.Status != "awaiting_confirmation" {
				t.Fatal("proposal blocked submission")
			}
		})
	}
}
