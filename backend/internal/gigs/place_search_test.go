package gigs

import (
	"context"
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
		{"formatted":"Санкт-Петербург, Тверская улица, 13","result_type":"building","country_code":"ru","city":"Санкт-Петербург","lat":59.95,"lon":30.39,"datasource":{"attribution":"OpenStreetMap"}},
		{"formatted":"Москва","result_type":"city","country_code":"ru","city":"Москва","lat":55,"lon":37},
		{"formatted":"Другой адрес","result_type":"building","country_code":"by","city":"Москва","lat":55,"lon":37,"datasource":{"attribution":"OpenStreetMap"}},
		{"formatted":"Москва, Тверская улица, 13","result_type":"building","country_code":"ru","city":"Москва","lat":55.76,"lon":37.61,"datasource":{"attribution":"© OpenStreetMap contributors"}},
		{"formatted":"Нет координаты","result_type":"building","country_code":"ru","city":"Москва","lon":37,"datasource":{"attribution":"OpenStreetMap"}},
		{"formatted":"Нет атрибуции","result_type":"building","country_code":"ru","city":"Москва","lat":55,"lon":37}
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

func TestPlaceSuggestions(t *testing.T) {
	const input = `{"city":"Киров, Калужская область","address":" Лени "}`
	const response = `{"results":[
		{"formatted":"Улица Ленина, Киров","address_line1":"Улица Ленина","result_type":"street","country_code":"ru","city":"Киров","state":"КАЛУЖСКАЯ область","lat":54.08,"lon":34.31,"datasource":{"attribution":"© OpenStreetMap contributors"}},
		{"formatted":"Улица Ленина, Киров, 249440","address_line1":"Улица Ленина","result_type":"street","country_code":"ru","city":"Киров","state":"Калужская область","lat":54.09,"lon":34.31,"datasource":{"attribution":"© OpenStreetMap contributors"}},
		{"formatted":"Ленина, 1, Киров","address_line1":"Ленина, 1","result_type":"building","country_code":"ru","city":"КИРОВ","state":"Калужская область","housenumber":"1","lat":54.08,"lon":34.32,"datasource":{"attribution":"© OpenStreetMap contributors"}},
		{"formatted":"Тёзка улицы, Киров","address_line1":"Ленина, 9","result_type":"building","country_code":"ru","city":"Киров","state":"Кировская область","housenumber":"9","lat":58.6,"lon":49.7,"datasource":{"attribution":"© OpenStreetMap contributors"}},
		{"formatted":"Другая Калуга","address_line1":"Ленина, 2","result_type":"building","country_code":"ru","city":"Калуга","state":"Калужская область","housenumber":"2","lat":54.5,"lon":36.2,"datasource":{"attribution":"© OpenStreetMap contributors"}},
		{"formatted":"Дом без номера","address_line1":"Ленина","result_type":"building","country_code":"ru","city":"Киров","state":"Калужская область","lat":54.08,"lon":34.31,"datasource":{"attribution":"© OpenStreetMap contributors"}},
		{"formatted":"Без атрибуции","address_line1":"Ленина, 3","result_type":"building","country_code":"ru","city":"Киров","state":"Калужская область","housenumber":"3","lat":54.08,"lon":34.31}
	]}`
	status := http.StatusOK
	body := response
	calls := 0
	search := &placeSearch{
		key: "fixture-key",
		client: &http.Client{Transport: placeTransport(func(request *http.Request) (*http.Response, error) {
			calls++
			query := request.URL.Query()
			if request.URL.Host != "api.geoapify.com" || request.URL.Path != "/v1/geocode/autocomplete" ||
				query.Get("text") != "Лени, Киров, Калужская область" || query.Get("limit") != "7" ||
				query.Get("filter") != "countrycode:ru" || query.Get("apiKey") != "fixture-key" {
				t.Error("incorrect Geoapify autocomplete request")
			}
			return &http.Response{
				StatusCode: status, Header: http.Header{"Retry-After": {"17"}},
				Body: io.NopCloser(strings.NewReader(body)),
			}, nil
		})},
	}
	send := suggestionRequest(search)
	if rec := send(t.Context(), `{"city":"Киров","address":" Ле "}`); rec.Code != 400 || calls != 0 {
		t.Fatalf("short input sent upstream: status %d, calls %d", rec.Code, calls)
	}

	rec := send(t.Context(), input)
	var items []placeSuggestion
	if err := json.Unmarshal(rec.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-store" || len(items) != 3 {
		t.Fatalf("wrong suggestions: %s", rec.Body.String())
	}
	if items[0].Kind != "street" || items[0].Address != "Улица Ленина" || items[0].Complete || items[0].Point != nil ||
		items[0].Region == "" || items[0].Attribution == "" {
		t.Fatalf("invalid street suggestion: %#v", items[0])
	}
	if house := items[1]; !house.Complete || house.Point == nil || house.Point.Source != "geoapify" ||
		*house.Point.Longitude != 34.32 || house.Point.Attribution == "" {
		t.Fatalf("invalid house suggestion: %#v", house)
	}
	if items[2].Complete || items[2].Point != nil {
		t.Fatalf("a building without house number should be incomplete: %#v", items[2])
	}
	if rec := send(t.Context(), input); rec.Code != 429 || rec.Header().Get("Retry-After") != "1" || calls != 1 {
		t.Fatalf("expected local throttle, status %d, calls %d", rec.Code, calls)
	}
	search.next = time.Time{}
	status = http.StatusTooManyRequests
	if rec := send(t.Context(), input); rec.Code != 429 || rec.Header().Get("Retry-After") != "17" {
		t.Fatalf("expected provider throttle and Retry-After, status %d", rec.Code)
	}
	search.next = time.Time{}
	status, body = http.StatusOK, `{"results":[]}`
	if rec := send(t.Context(), input); rec.Code != 200 || rec.Body.String() != "[]" {
		t.Fatalf("wrong empty result: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPlaceSuggestionsTimeoutAndCancellation(t *testing.T) {
	const input = `{"city":"Москва","address":"Твер"}`
	started := make(chan struct{}, 2)
	search := &placeSearch{
		key: "fixture-key",
		client: &http.Client{Timeout: 25 * time.Millisecond, Transport: placeTransport(func(request *http.Request) (*http.Response, error) {
			started <- struct{}{}
			<-request.Context().Done()
			return nil, request.Context().Err()
		})},
	}
	send := suggestionRequest(search)
	if rec := send(t.Context(), input); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("wrong timeout status: %d", rec.Code)
	}
	<-started
	search.next = time.Time{}
	search.client.Timeout = time.Second
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	finished := make(chan *httptest.ResponseRecorder, 1)
	go func() { finished <- send(ctx, input) }()
	select {
	case <-started:
		cancel()
	case <-time.After(time.Second):
		t.Fatal("request did not reach upstream")
	}
	select {
	case rec := <-finished:
		if rec.Body.Len() != 0 {
			t.Fatal("cancelled request returned an application response")
		}
	case <-time.After(time.Second):
		t.Fatal("request cancellation did not reach upstream")
	}
}

func suggestionRequest(search *placeSearch) func(context.Context, string) *httptest.ResponseRecorder {
	router := gin.New()
	router.POST("/suggest", search.suggest)
	return func(ctx context.Context, input string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/suggest", strings.NewReader(input))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(rec, req)
		return rec
	}
}
