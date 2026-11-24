package gigs

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type placeTransport func(*http.Request) (*http.Response, error)

func (transport placeTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestPlaceSearch(t *testing.T) {
	const input = `{"city":" Москва ","address":"Тверская, 13"}`
	const response = `{"results":[
		{"formatted":"Москва","result_type":"city","country_code":"ru","lat":55,"lon":37},
		{"formatted":"Другой адрес","result_type":"building","country_code":"by","lat":55,"lon":37,"datasource":{"attribution":"OpenStreetMap"}},
		{"formatted":"Москва, Тверская улица, 13","result_type":"building","country_code":"ru","lat":55.76,"lon":37.61,"datasource":{"attribution":"© OpenStreetMap contributors"}},
		{"formatted":"Нет координаты","result_type":"building","country_code":"ru","lon":37,"datasource":{"attribution":"OpenStreetMap"}},
		{"formatted":"Нет атрибуции","result_type":"building","country_code":"ru","lat":55,"lon":37}
	]}`
	gin.SetMode(gin.TestMode)
	search := &placeSearch{client: &http.Client{}}
	router := gin.New()
	router.POST("/search", search.find)
	send := func(body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/search", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)
		return recorder
	}
	if rec := send(input); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("without key: %d", rec.Code)
	}
	search.key = "fixture-key"
	upstreamStatus := http.StatusOK
	calls := 0
	search.client.Transport = placeTransport(func(request *http.Request) (*http.Response, error) {
		calls++
		query := request.URL.Query()
		if request.URL.Host != "api.geoapify.com" || query.Get("text") != "Тверская, 13, Москва" ||
			query.Get("limit") != "3" || query.Get("filter") != "countrycode:ru" || query.Get("apiKey") != search.key {
			t.Errorf("incorrect Geoapify request")
		}
		return &http.Response{StatusCode: upstreamStatus, Body: io.NopCloser(strings.NewReader(response))}, nil
	})
	if rec := send(`{"city":"Москва","address":""}`); rec.Code != http.StatusBadRequest || calls != 0 {
		t.Fatalf("invalid address reached the provider: %d, calls %d", rec.Code, calls)
	}
	recorder := send(input)
	var results []placeResult
	if err := json.Unmarshal(recorder.Body.Bytes(), &results); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" || len(results) != 1 ||
		results[0].Label != "Москва, Тверская улица, 13" || *results[0].Point.Latitude != 55.76 ||
		results[0].Point.Source != "geoapify" || results[0].Point.Attribution != "© OpenStreetMap contributors" ||
		strings.Contains(recorder.Body.String(), search.key) {
		t.Fatalf("incorrect place results: %s", recorder.Body.String())
	}
	search.next = time.Now().Add(time.Minute)
	if rec := send(input); rec.Code != http.StatusTooManyRequests || calls != 1 || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("local rate limit: %d, calls %d", rec.Code, calls)
	}
	search.next = time.Time{}
	upstreamStatus = http.StatusTooManyRequests
	if rec := send(input); rec.Code != http.StatusTooManyRequests || calls != 2 {
		t.Fatalf("provider rate limit: %d, calls %d", rec.Code, calls)
	}
	search.next = time.Time{}
	upstreamStatus = http.StatusBadGateway
	if rec := send(input); rec.Code != http.StatusServiceUnavailable || strings.Contains(rec.Body.String(), search.key) {
		t.Fatalf("provider failure was not handled: %d", rec.Code)
	}
}
