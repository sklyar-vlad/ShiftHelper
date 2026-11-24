package gigs

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

type placeSearch struct {
	key    string
	client *http.Client
	mu     sync.Mutex
	next   time.Time
}

type placeResult struct {
	Label string   `json:"label"`
	Point gigPoint `json:"point"`
}

func NewPlaceSearch(key string) gin.HandlerFunc {
	search := &placeSearch{
		key: strings.TrimSpace(key),
		client: &http.Client{
			Timeout: 5 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
	return search.find
}

func (s *placeSearch) allow() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if now.Before(s.next) {
		return false
	}
	s.next = now.Add(300 * time.Millisecond)
	return true
}

func (s *placeSearch) find(c *gin.Context) {
	var input struct {
		City    string `json:"city"`
		Address string `json:"address"`
	}
	if !httpapi.DecodeJSON(c, &input, 4096) {
		return
	}
	input.City = strings.TrimSpace(input.City)
	input.Address = strings.TrimSpace(input.Address)
	if input.City == "" || utf8.RuneCountInString(input.City) > 100 ||
		input.Address == "" || utf8.RuneCountInString(input.Address) > 300 ||
		strings.ContainsRune(input.City+input.Address, 0) {
		httpapi.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Укажите город и адрес допустимой длины.")
		return
	}
	if s.key == "" {
		httpapi.Fail(c, http.StatusServiceUnavailable, "INTERNAL_ERROR", "Поиск адреса на карте не настроен. Можно использовать текстовый адрес.")
		return
	}
	if !s.allow() {
		c.Header("Retry-After", "1")
		httpapi.Fail(c, http.StatusTooManyRequests, "RATE_LIMITED", "Слишком много запросов. Попробуйте чуть позже.")
		return
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, "https://api.geoapify.com/v1/geocode/search", nil)
	if err != nil {
		httpapi.InternalError(c)
		return
	}
	query := req.URL.Query()
	query.Set("text", input.Address+", "+input.City)
	query.Set("filter", "countrycode:ru")
	query.Set("lang", "ru")
	query.Set("format", "json")
	query.Set("limit", "3")
	query.Set("apiKey", s.key)
	req.URL.RawQuery = query.Encode()

	response, err := s.client.Do(req)
	if err != nil {
		placeSearchUnavailable(c)
		return
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusTooManyRequests {
		httpapi.Fail(c, http.StatusTooManyRequests, "RATE_LIMITED", "Достигнут лимит поиска адресов. Попробуйте позже.")
		return
	}
	var body struct {
		Results []struct {
			Latitude   *float64 `json:"lat"`
			Longitude  *float64 `json:"lon"`
			Label      string   `json:"formatted"`
			Type       string   `json:"result_type"`
			Country    string   `json:"country_code"`
			Datasource struct {
				Attribution string `json:"attribution"`
			} `json:"datasource"`
		} `json:"results"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(http.MaxBytesReader(nil, response.Body, 128<<10)).Decode(&body) != nil || body.Results == nil {
		placeSearchUnavailable(c)
		return
	}
	results := make([]placeResult, 0, 3)
	for _, result := range body.Results {
		label := strings.TrimSpace(result.Label)
		point := gigPoint{
			Latitude:    result.Latitude,
			Longitude:   result.Longitude,
			Source:      "geoapify",
			Attribution: strings.TrimSpace(result.Datasource.Attribution),
		}
		if result.Country != "ru" || (result.Type != "building" && result.Type != "amenity") || label == "" || !point.valid() {
			continue
		}
		results = append(results, placeResult{Label: label, Point: point})
		if len(results) == 3 {
			break
		}
	}

	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, results)
}

func placeSearchUnavailable(c *gin.Context) {
	httpapi.Fail(c, http.StatusServiceUnavailable, "INTERNAL_ERROR", "Не удалось найти адрес на карте. Можно продолжить с текстовым адресом.")
}
