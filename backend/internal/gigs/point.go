package gigs

import (
	"bytes"
	"encoding/json"
	"strings"
	"unicode/utf8"
)

type gigPoint struct {
	Latitude    *float64 `json:"latitude"`
	Longitude   *float64 `json:"longitude"`
	Source      string   `json:"source"`
	Attribution string   `json:"attribution,omitempty"`
}

func (input *termsInput) normalizePoint() bool {
	if len(input.Point) == 0 || bytes.Equal(input.Point, []byte("null")) {
		return true
	}
	var point gigPoint
	decoder := json.NewDecoder(bytes.NewReader(input.Point))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&point); err != nil || point.Latitude == nil || point.Longitude == nil ||
		*point.Latitude < -90 || *point.Latitude > 90 || *point.Longitude < -180 || *point.Longitude > 180 {
		return false
	}
	if point.Source == "" {
		point.Source = "manual"
	}
	point.Attribution = strings.TrimSpace(point.Attribution)
	if (point.Source != "manual" && point.Source != "geoapify") ||
		(point.Source == "geoapify" && point.Attribution == "") ||
		utf8.RuneCountInString(point.Attribution) > 300 || strings.ContainsRune(point.Attribution, 0) {
		return false
	}
	normalized, err := json.Marshal(point)
	if err != nil {
		return false
	}
	input.Point = normalized
	return true
}
