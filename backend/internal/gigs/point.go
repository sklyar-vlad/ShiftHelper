package gigs

import (
	"bytes"
	"encoding/json"
	"strings"
	"unicode/utf8"
)

type coordinates struct {
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
}

func (point coordinates) valid() bool {
	return point.Latitude != nil && point.Longitude != nil &&
		*point.Latitude >= -90 && *point.Latitude <= 90 && *point.Longitude >= -180 && *point.Longitude <= 180
}

type gigPoint struct {
	coordinates
	Source           string       `json:"source"`
	Attribution      string       `json:"attribution,omitempty"`
	AddressReference *coordinates `json:"addressReference,omitempty"`
}

func (input *termsInput) normalizePoint() bool {
	if len(input.Point) == 0 || bytes.Equal(input.Point, []byte("null")) {
		return true
	}
	var point gigPoint
	decoder := json.NewDecoder(bytes.NewReader(input.Point))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&point); err != nil {
		return false
	}
	if point.Source == "" {
		point.Source = "manual"
	}
	point.Attribution = strings.TrimSpace(point.Attribution)
	if !point.valid() {
		return false
	}
	normalized, err := json.Marshal(point)
	if err != nil {
		return false
	}
	input.Point = normalized
	return true
}

func (point gigPoint) valid() bool {
	return point.coordinates.valid() &&
		(point.Source == "manual" || (point.Source == "geoapify" && point.Attribution != "")) &&
		(point.AddressReference == nil || (point.Source == "geoapify" && point.AddressReference.valid())) &&
		validAttribution(point.Attribution)
}

func validAttribution(value string) bool {
	return utf8.RuneCountInString(value) <= 300 && !strings.ContainsRune(value, 0)
}
