package gigs

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

const (
	geoapifySearch       = "https://api.geoapify.com/v1/geocode/search"
	geoapifyAutocomplete = "https://api.geoapify.com/v1/geocode/autocomplete"
	suggestionLimit      = 7
)

type placeSearch struct {
	key    string
	client *http.Client
	mu     sync.Mutex
	next   time.Time
}

type placeInput struct {
	City    string `json:"city"`
	Address string `json:"address"`
}

type geoapifyPlace struct {
	Latitude    *float64 `json:"lat"`
	Longitude   *float64 `json:"lon"`
	Label       string   `json:"formatted"`
	Address     string   `json:"address_line1"`
	Type        string   `json:"result_type"`
	Country     string   `json:"country_code"`
	City        string   `json:"city"`
	Region      string   `json:"state"`
	HouseNumber string   `json:"housenumber"`
	Datasource  struct {
		Attribution string `json:"attribution"`
	} `json:"datasource"`
}

func (p geoapifyPlace) point() gigPoint {
	addressReference := coordinates{Latitude: p.Latitude, Longitude: p.Longitude}
	return gigPoint{
		coordinates: addressReference, Source: "geoapify",
		Attribution:      strings.TrimSpace(p.Datasource.Attribution),
		AddressReference: &addressReference,
	}
}

func (p geoapifyPlace) inCity(city, region string) bool {
	return city != "" && p.Country == "ru" && normalizePlaceName(p.City) == city &&
		(region == "" || normalizePlaceName(p.Region) == region)
}

type placeResult struct {
	Label string   `json:"label"`
	Point gigPoint `json:"point"`
}

type placeSuggestion struct {
	Label       string    `json:"label"`
	Address     string    `json:"address"`
	City        string    `json:"city"`
	Region      string    `json:"region,omitempty"`
	Kind        string    `json:"kind"`
	Complete    bool      `json:"complete"`
	Attribution string    `json:"attribution"`
	Point       *gigPoint `json:"point,omitempty"`
}

func NewPlaceSearch(key string) (gin.HandlerFunc, gin.HandlerFunc) {
	search := &placeSearch{
		key: strings.TrimSpace(key),
		client: &http.Client{
			Timeout: 5 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
	return search.find, search.suggest
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

func readPlaceInput(c *gin.Context, minAddressLength int) (placeInput, bool) {
	var input placeInput
	if !httpapi.DecodeJSON(c, &input, 4096) {
		return input, false
	}
	input.City = strings.TrimSpace(input.City)
	input.Address = strings.TrimSpace(input.Address)
	addressLength := utf8.RuneCountInString(input.Address)
	if input.City == "" || utf8.RuneCountInString(input.City) > 100 ||
		addressLength < minAddressLength || addressLength > 300 ||
		strings.ContainsRune(input.City+input.Address, 0) {
		httpapi.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Укажите город и адрес допустимой длины.")
		return input, false
	}
	return input, true
}

func (s *placeSearch) find(c *gin.Context) {
	input, ok := readPlaceInput(c, 1)
	if !ok {
		return
	}
	city, region := splitPlaceCity(input.City)
	found, ok := s.lookup(c, input, geoapifySearch, 3)
	if !ok {
		return
	}
	results := make([]placeResult, 0, 3)
	for _, result := range found {
		label := strings.TrimSpace(result.Label)
		point := result.point()
		if !result.inCity(city, region) || (result.Type != "building" && result.Type != "amenity") || label == "" || !point.valid() {
			continue
		}
		results = append(results, placeResult{Label: label, Point: point})
		if len(results) == 3 {
			break
		}
	}
	c.JSON(http.StatusOK, results)
}

func (s *placeSearch) suggest(c *gin.Context) {
	input, ok := readPlaceInput(c, 3)
	if !ok {
		return
	}
	city, region := splitPlaceCity(input.City)
	if city == "" {
		httpapi.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Укажите город.")
		return
	}

	found, ok := s.lookup(c, input, geoapifyAutocomplete, suggestionLimit)
	if !ok {
		return
	}
	results := make([]placeSuggestion, 0, suggestionLimit)
	seen := make(map[string]struct{}, suggestionLimit)
	for _, result := range found {
		if !result.inCity(city, region) {
			continue
		}
		if result.Type != "street" && result.Type != "building" && result.Type != "amenity" {
			continue
		}
		label := strings.TrimSpace(result.Label)
		point := result.point()
		address := strings.TrimSpace(result.Address)
		if label == "" || address == "" || point.Attribution == "" || !validAttribution(point.Attribution) {
			continue
		}
		labelKey := normalizePlaceName(label)
		if result.Type == "street" {
			labelKey = strings.Join([]string{"street", normalizePlaceName(address), city, normalizePlaceName(result.Region)}, "\x00")
		}
		if _, duplicate := seen[labelKey]; duplicate {
			continue
		}
		seen[labelKey] = struct{}{}
		suggestion := placeSuggestion{
			Label: label, Address: address, City: strings.TrimSpace(result.City), Region: strings.TrimSpace(result.Region),
			Kind: result.Type, Attribution: point.Attribution,
		}
		if result.Type != "street" && strings.TrimSpace(result.HouseNumber) != "" && point.valid() {
			suggestion.Complete = true
			suggestion.Point = &point
		}
		results = append(results, suggestion)
		if len(results) == suggestionLimit {
			break
		}
	}
	c.JSON(http.StatusOK, results)
}

func splitPlaceCity(value string) (string, string) {
	city, region, _ := strings.Cut(value, ",")
	return normalizePlaceName(city), normalizePlaceName(strings.TrimSuffix(strings.TrimSpace(region), " (город федерального значения)"))
}

func normalizePlaceName(value string) string {
	return strings.ReplaceAll(strings.ToLower(strings.Join(strings.Fields(value), " ")), "ё", "е")
}

func (s *placeSearch) lookup(c *gin.Context, input placeInput, endpoint string, limit int) ([]geoapifyPlace, bool) {
	c.Header("Cache-Control", "no-store")
	if c.Request.Context().Err() != nil {
		return nil, false
	}
	if s.key == "" {
		httpapi.Fail(c, http.StatusServiceUnavailable, "INTERNAL_ERROR", "Поиск адреса на карте не настроен. Можно использовать текстовый адрес.")
		return nil, false
	}
	if !s.allow() {
		c.Header("Retry-After", "1")
		httpapi.Fail(c, http.StatusTooManyRequests, "RATE_LIMITED", "Слишком много запросов. Попробуйте чуть позже.")
		return nil, false
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, endpoint, nil)
	if err != nil {
		httpapi.InternalError(c)
		return nil, false
	}
	query := req.URL.Query()
	query.Set("text", input.Address+", "+input.City)
	query.Set("filter", "countrycode:ru")
	query.Set("lang", "ru")
	query.Set("format", "json")
	query.Set("limit", strconv.Itoa(limit))
	query.Set("apiKey", s.key)
	req.URL.RawQuery = query.Encode()

	response, err := s.client.Do(req)
	if err != nil {
		if c.Request.Context().Err() == nil {
			placeSearchUnavailable(c)
		}
		return nil, false
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusTooManyRequests {
		c.Header("Retry-After", retryAfterSeconds(response.Header.Get("Retry-After")))
		httpapi.Fail(c, http.StatusTooManyRequests, "RATE_LIMITED", "Достигнут лимит поиска адресов. Попробуйте позже.")
		return nil, false
	}
	var body struct {
		Results []geoapifyPlace `json:"results"`
	}
	if response.StatusCode != http.StatusOK ||
		json.NewDecoder(http.MaxBytesReader(nil, response.Body, 128<<10)).Decode(&body) != nil || body.Results == nil {
		placeSearchUnavailable(c)
		return nil, false
	}
	return body.Results, true
}

func retryAfterSeconds(value string) string {
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return strconv.Itoa(seconds)
	}
	if until, err := http.ParseTime(value); err == nil {
		if wait := time.Until(until); wait > 0 {
			return strconv.Itoa(int((wait-1)/time.Second) + 1)
		}
	}
	return "5"
}

func placeSearchUnavailable(c *gin.Context) {
	httpapi.Fail(c, http.StatusServiceUnavailable, "INTERNAL_ERROR", "Не удалось найти адрес на карте. Можно продолжить с текстовым адресом.")
}
