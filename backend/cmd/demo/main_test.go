package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/handler"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/migrations"
	"go.uber.org/zap"
)

func demoDatabase(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to test demo data")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	t.Cleanup(cancel)
	settings, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := pgxpool.NewWithConfig(ctx, settings)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := pgx.Identifier{"demo_test_" + strings.ToLower(rand.Text())}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	settings.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, settings)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := migrations.Run(ctx, pool, "up", io.Discard); err != nil {
		t.Fatal(err)
	}
	return ctx, pool
}

func TestDemoSeed(t *testing.T) {
	ctx, pool := demoDatabase(t)
	customerPassword, workerPassword := rand.Text(), rand.Text()
	now := time.Now().UTC().Truncate(time.Second)
	if err := seed(ctx, pool, "", workerPassword, now); err == nil {
		t.Fatal("empty password accepted")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO users (email,password_hash,role,name) VALUES ('demo.worker@example.test','original-hash','worker','Existing user')`); err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	errors := make(chan error, 2)
	for range 2 {
		wait.Go(func() { errors <- seed(ctx, pool, customerPassword, workerPassword, now) })
	}
	wait.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	var users, jobs, applications, statuses int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM gigs), (SELECT count(*) FROM applications), (SELECT count(DISTINCT status) FROM gigs)`).Scan(&users, &jobs, &applications, &statuses); err != nil || users != 4 || jobs != 7 || applications != 9 || statuses != 5 {
		t.Fatal("concurrent seed duplicated data or missed states")
	}
	router := handler.NewRouter(zap.NewNop(), pool, "", "http://shifthelper.localhost")
	login := func(email, password string) *http.Cookie {
		t.Helper()
		data, _ := json.Marshal(map[string]string{"email": email, "password": password})
		request := httptest.NewRequest("POST", "http://shifthelper.localhost/api/v1/auth/login", strings.NewReader(string(data))).WithContext(ctx)
		request.Header.Set("Origin", "http://shifthelper.localhost")
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != 200 {
			t.Fatal("demo credentials do not work")
		}
		return response.Result().Cookies()[0]
	}
	cookie := login("showcase.customer@example.test", customerPassword)
	login("showcase.worker@example.test", workerPassword)
	login("showcase.worker2@example.test", workerPassword)
	request := httptest.NewRequest("POST", "http://shifthelper.localhost/api/v1/gigs/"+demoID(101)+"/cancel", nil).WithContext(ctx)
	request.Header.Set("Origin", "http://shifthelper.localhost")
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatal("demo job cannot pass through real API")
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET name='Changed name', bio='User bio' WHERE id=$1;
    `, demoID(2)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO gigs (customer_id,title,description,city,address,starts_at,ends_at,amount_kopecks)
        VALUES ($1,'User job','Do not remove','Moscow','Example',now()+interval '1 day',now()+interval '2 days',10000)`, demoID(1)); err != nil {
		t.Fatal(err)
	}
	workerPassword = rand.Text()
	future := now.AddDate(0, 0, 40)
	if err := seed(ctx, pool, customerPassword, workerPassword, future); err != nil {
		t.Fatal(err)
	}
	login("showcase.worker@example.test", workerPassword)
	var status, name, bio, oldHash string
	var start time.Time
	if err := pool.QueryRow(ctx, "SELECT status FROM gigs WHERE id=$1", demoID(101)).Scan(&status); err != nil || status != "cancelled" {
		t.Fatal("rerun reset an already used demo job")
	}
	if err := pool.QueryRow(ctx, "SELECT starts_at FROM gigs WHERE id=$1", demoID(102)).Scan(&start); err != nil || !start.After(future) {
		t.Fatal("open demo job has a stale date")
	}
	if err := pool.QueryRow(ctx, "SELECT name,bio FROM users WHERE id=$1", demoID(2)).Scan(&name, &bio); err != nil || name != "Changed name" || bio != "User bio" {
		t.Fatal("rerun overwrote edited profile")
	}
	if err := pool.QueryRow(ctx, "SELECT password_hash FROM users WHERE email='demo.worker@example.test'").Scan(&oldHash); err != nil || oldHash != "original-hash" {
		t.Fatal("existing demo user was changed")
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM gigs").Scan(&jobs); err != nil || jobs != 8 {
		t.Fatal("rerun deleted a user's job or created duplicates")
	}
}

func TestDemoCollisionRollsBack(t *testing.T) {
	for _, collision := range []string{"email", "account_id", "job_id"} {
		t.Run(collision, func(t *testing.T) {
			ctx, pool := demoDatabase(t)
			email, id := "existing@example.test", "90000000-0000-4000-8000-000000000001"
			if collision == "email" {
				email = "showcase.customer@example.test"
			}
			if collision == "account_id" {
				id = demoID(2)
			}
			if _, err := pool.Exec(ctx, "INSERT INTO users (id,email,password_hash,role,name) VALUES ($1,$2,'keep','customer','Keep')", id, email); err != nil {
				t.Fatal(err)
			}
			if collision == "job_id" {
				if _, err := pool.Exec(ctx, `INSERT INTO gigs (id,customer_id,title,description,city,address,starts_at,ends_at,amount_kopecks) VALUES ($1,$2,'Keep','Keep','City','Address',now(),now()+interval '1 hour',1)`, demoID(102), id); err != nil {
					t.Fatal(err)
				}
			}
			if err := seed(ctx, pool, rand.Text(), rand.Text(), time.Now()); err == nil {
				t.Fatal("collision did not stop seed")
			}
			var count int
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&count); err != nil || count != 1 {
				t.Fatal("failed seed partially changed user data")
			}
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM applications").Scan(&count); err != nil || count != 0 {
				t.Fatal("failed seed left applications")
			}
		})
	}
}
