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

	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"go.uber.org/zap"
)

func TestPrivateContacts(t *testing.T) {
	ctx, pool := testDatabase(t)
	ids := make([]string, 4)
	cookies := make([]*http.Cookie, 4)
	for i := range ids {
		role := "worker"
		if i == 0 || i == 3 {
			role = "customer"
		}
		if err := pool.QueryRow(ctx, `INSERT INTO users(email,password_hash,role,name,contact) VALUES($1,'test',$2,'Name',$3) RETURNING id::text`, fmt.Sprintf("contact%d@example.test", i), role, fmt.Sprintf("private-contact-%d", i)).Scan(&ids[i]); err != nil {
			t.Fatal(err)
		}
		token := rand.Text()
		hash := sha256.Sum256([]byte(token))
		if _, err := pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')`, hash[:], ids[i]); err != nil {
			t.Fatal(err)
		}
		cookies[i] = &http.Cookie{Name: "shifthelper_session", Value: token}
	}
	var gigID string
	if err := pool.QueryRow(ctx, `INSERT INTO gigs(customer_id,title,description,city,address,starts_at,ends_at,amount_kopecks) VALUES($1,'Work','Details','City','Address',now()+interval '1 day',now()+interval '2 days',100) RETURNING id::text`, ids[0]).Scan(&gigID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO applications(gig_id,worker_id,status) VALUES($1,$2,'selected'),($1,$3,'rejected')`, gigID, ids[1], ids[2]); err != nil {
		t.Fatal(err)
	}
	router := handler.NewRouter(zap.NewNop(), pool, "", "http://shifthelper.localhost")
	send := func(method, path, body string, viewer int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "http://shifthelper.localhost/api/v1"+path, strings.NewReader(body))
		req.Header.Set("Origin", "http://shifthelper.localhost")
		req.Header.Set("Content-Type", "application/json")
		if viewer >= 0 {
			req.AddCookie(cookies[viewer])
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	for _, status := range []string{"open", "in_progress", "awaiting_confirmation", "completed", "cancelled"} {
		_, err := pool.Exec(ctx, `UPDATE gigs SET status=$2,selected_worker_id=CASE WHEN $2 IN ('open','cancelled') THEN NULL ELSE $3::uuid END,submitted_at=CASE WHEN $2 IN ('awaiting_confirmation','completed') THEN now() END,completed_at=CASE WHEN $2='completed' THEN now() END,cancelled_at=CASE WHEN $2='cancelled' THEN now() END WHERE id=$1`, gigID, status, ids[1])
		if err != nil {
			t.Fatal(err)
		}
		for viewer := -1; viewer < 4; viewer++ {
			r := send("GET", "/gigs/"+gigID, "", viewer)
			var body map[string]any
			if err := json.Unmarshal(r.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			shouldSee := (viewer == 0 || viewer == 1) && status != "open" && status != "cancelled"
			contact, exists := body["counterpartyContact"]
			if shouldSee {
				if r.Code != 200 || contact != fmt.Sprintf("private-contact-%d", 1-viewer) {
					t.Fatalf("contact missing for %d/%s: %s", viewer, status, r.Body.String())
				}
			} else if exists || strings.Contains(r.Body.String(), "private-contact-") {
				t.Fatalf("contact leaked for %d/%s", viewer, status)
			}
		}
	}
	for i := range 2 {
		for _, value := range []string{"  <b>messenger</b>  ", ""} {
			b, _ := json.Marshal(map[string]string{"name": "Name", "bio": "", "contact": value})
			r := send("PATCH", "/me", string(b), i)
			if r.Code != 200 || !strings.Contains(r.Body.String(), `"contact":`) {
				t.Fatal("contact update failed", r.Code)
			}
			r = send("GET", "/me", "", i)
			var body map[string]any
			_ = json.Unmarshal(r.Body.Bytes(), &body)
			if body["contact"] != strings.TrimSpace(value) {
				t.Fatal("own contact not persisted")
			}
		}
		for _, value := range []string{strings.Repeat("я", 201), "nul\x00byte"} {
			b, _ := json.Marshal(map[string]string{"name": "Name", "bio": "", "contact": value})
			if send("PATCH", "/me", string(b), i).Code != 400 {
				t.Fatal("invalid contact accepted")
			}
		}
		for _, path := range []string{"/users/" + ids[i], "/gigs", "/me/gigs"} {
			r := send("GET", path, "", i)
			if strings.Contains(r.Body.String(), `"contact"`) || strings.Contains(r.Body.String(), "private-contact-") {
				t.Fatal("private contact in public projection", path)
			}
		}
	}
	// An absent contact stays an explicit empty string for the selected participant.
	if _, err := pool.Exec(ctx, `UPDATE gigs SET status='in_progress',selected_worker_id=$2,cancelled_at=NULL WHERE id=$1`, gigID, ids[1]); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(send("GET", "/gigs/"+gigID, "", 0).Body.String(), `"counterpartyContact":""`) {
		t.Fatal("empty contact unavailable")
	}
}
