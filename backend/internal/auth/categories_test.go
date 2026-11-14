package auth_test

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sklyar-vlad/ShiftHelper/backend/internal/gigs"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/migrations"
	"go.uber.org/zap"
)

func TestGigCategories(t *testing.T) {
	ctx, pool := testDatabase(t)
	if err := migrations.Run(ctx, pool, "down", io.Discard); err != nil {
		t.Fatal(err)
	}
	const customer = "00000000-0000-0000-0000-000000000001"
	const worker = "00000000-0000-0000-0000-000000000002"
	const old = "00000000-0000-0000-0000-000000000101"
	const working = "00000000-0000-0000-0000-000000000102"
	_, err := pool.Exec(ctx, `
 INSERT INTO users(id,email,password_hash,role,name) VALUES
 ('00000000-0000-0000-0000-000000000001','category-c@example.test','test','customer','Customer'),
 ('00000000-0000-0000-0000-000000000002','category-w@example.test','test','worker','Worker');
 INSERT INTO gigs(id,customer_id,title,description,city,address,starts_at,ends_at,amount_kopecks) SELECT
 ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001','Legacy','Details','Москва','Address',now()+interval '1 day',now()+interval '2 days',150050 FROM generate_series(101,102) n;
 INSERT INTO applications(gig_id,worker_id,status) VALUES('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000002','selected');
 UPDATE gigs SET status='in_progress',selected_worker_id='00000000-0000-0000-0000-000000000002' WHERE id='00000000-0000-0000-0000-000000000102';
 INSERT INTO gig_changes(gig_id,base_version,terms) SELECT id,terms_version,jsonb_build_object('title',title,'description',description,'requirements',requirements,'city',city,'address',address,'startsAt',starts_at,'endsAt',ends_at,'amountKopecks',amount_kopecks) FROM gigs WHERE id='00000000-0000-0000-0000-000000000102';`)
	if err != nil {
		t.Fatal(err)
	}
	if err := migrations.Run(ctx, pool, "up", io.Discard); err != nil {
		t.Fatal(err)
	}
	cookies := make([]*http.Cookie, 2)
	for i, id := range []string{customer, worker} {
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
		var g gigs.Gig
		if err := json.Unmarshal(r.Body.Bytes(), &g); err != nil {
			t.Fatal(err)
		}
		return g
	}
	payload := func(g gigs.Gig) map[string]any {
		return map[string]any{"title": g.Title, "description": g.Description, "requirements": g.Requirements, "city": g.City, "address": g.Address, "startsAt": g.StartsAt.Format(time.RFC3339Nano), "endsAt": g.EndsAt.Format(time.RFC3339Nano), "amountKopecks": g.AmountKopecks, "termsVersion": g.TermsVersion}
	}
	categories := send("GET", "/gig-categories", nil, -1)
	expect(categories, 200)
	var list []gigs.Category
	if err := json.Unmarshal(categories.Body.Bytes(), &list); err != nil || len(list) != 10 || list[0].Code != "repair" || list[9].Code != "other" || list[9].Name != "Другое" {
		t.Fatal("wrong category dictionary", err)
	}
	g := decode(send("GET", "/gigs/"+old, nil, -1), 200)
	if g.Category != "other" || g.AmountKopecks != 150050 {
		t.Fatal("migration lost legacy values")
	}
	create := payload(g)
	delete(create, "termsVersion")
	created := decode(send("POST", "/gigs", create, 0), 201)
	if created.Category != "other" {
		t.Fatal("missing default")
	}
	for _, bad := range []any{nil, "", "unknown", "REPAIR", 1, []string{"repair"}} {
		create["category"] = bad
		expect(send("POST", "/gigs", create, 0), 400)
	}
	create["category"] = "repair"
	created = decode(send("POST", "/gigs", create, 0), 201)
	if created.Category != "repair" {
		t.Fatal("explicit category not persisted")
	}
	path := "/gigs/" + created.ID
	read := send("POST", path+"/applications", map[string]any{"termsVersion": created.TermsVersion}, 1)
	expect(read, 201)
	var app gigs.Application
	if err := json.Unmarshal(read.Body.Bytes(), &app); err != nil {
		t.Fatal(err)
	}
	omitted := payload(created)
	created = decode(send("PUT", path+"/terms", omitted, 0), 200)
	if created.Category != "repair" {
		t.Fatal("omission reset category")
	}
	change := payload(created)
	change["category"] = "cleaning"
	expect(send("PUT", path+"/terms", change, 1), 403)
	expect(send("PUT", path+"/terms", change, -1), 401)
	before := created.TermsVersion
	created = decode(send("PUT", path+"/terms", change, 0), 200)
	if created.Category != "cleaning" || created.TermsVersion != before+1 {
		t.Fatal("category edit bypassed revision")
	}
	expect(send("POST", path+"/applications/"+app.ID+"/select", nil, 0), 409)
	expect(send("POST", path+"/applications/"+app.ID+"/confirm-terms", map[string]any{"termsVersion": created.TermsVersion}, 1), 200)
	created = decode(send("POST", path+"/applications/"+app.ID+"/select", nil, 0), 200)
	change = payload(created)
	change["category"] = "unknown"
	expect(send("PUT", path+"/terms", change, 0), 400)
	change["category"] = "moving"
	proposed := decode(send("PUT", path+"/terms", change, 0), 200)
	if proposed.Category != "cleaning" || proposed.PendingChange == nil {
		t.Fatal("proposal overwrote category")
	}
	changeID := proposed.PendingChange.ID
	expect(send("POST", path+"/changes/"+changeID+"/accept", nil, 0), 403)
	created = decode(send("POST", path+"/changes/"+changeID+"/accept", nil, 1), 200)
	if created.Category != "moving" {
		t.Fatal("category not applied with consent")
	}
	expect(send("POST", path+"/changes/"+changeID+"/accept", nil, 1), 409)
	if _, err := pool.Exec(ctx, "UPDATE gigs SET category='plumbing' WHERE id=$1", working); err != nil {
		t.Fatal(err)
	}
	legacy := decode(send("GET", "/gigs/"+working, nil, 0), 200)
	if legacy.PendingChange == nil {
		t.Fatal("migration lost old proposal")
	}
	legacy = decode(send("POST", "/gigs/"+working+"/changes/"+legacy.PendingChange.ID+"/accept", nil, 1), 200)
	if legacy.Category != "plumbing" {
		t.Fatal("legacy proposal reset category")
	}
	for _, tc := range []struct {
		path  string
		actor int
	}{{"/gigs", -1}, {"/me/gigs", 0}, {"/me/gigs", 1}, {"/me/applications", 1}} {
		r := send("GET", tc.path, nil, tc.actor)
		expect(r, 200)
		if !strings.Contains(r.Body.String(), `"category":`) {
			t.Fatal("category missing from projection", tc.path)
		}
	}
}
