package httpapi

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func ValidUUID(value string) bool { return uuidPattern.MatchString(value) }

func Pagination(c *gin.Context) (page, pageSize int64, fields map[string][]string) {
	page, pageSize = 1, 20
	fields = make(map[string][]string)
	query := c.Request.URL.Query()
	for _, param := range []struct {
		name  string
		value *int64
		max   int64
	}{
		{"page", &page, 2147483647}, {"pageSize", &pageSize, 100},
	} {
		if query.Has(param.name) {
			value, err := strconv.ParseInt(query.Get(param.name), 10, 32)
			if err != nil || value < 1 || value > param.max {
				fields[param.name] = []string{"Укажите допустимое положительное целое число."}
			} else {
				*param.value = value
			}
		}
	}
	return
}

func ValidateQuery(allowed ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		values, err := url.ParseQuery(c.Request.URL.RawQuery)
		valid := err == nil
		if valid {
			for key, items := range values {
				if len(items) != 1 || !slices.Contains(allowed, key) || !utf8.ValidString(items[0]) || strings.ContainsRune(items[0], 0) {
					valid = false
					break
				}
			}
		}
		if !valid {
			Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Некорректные параметры запроса.")
		}
	}
}

func DecodeJSON(c *gin.Context, input any, maxBytes int64) bool {
	contentType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes))
	decoder.DisallowUnknownFields()
	if err != nil || contentType != "application/json" ||
		decoder.Decode(input) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Некорректный JSON или параметры запроса.")
		return false
	}
	return true
}

func ValidationError(c *gin.Context, fields map[string][]string) bool {
	if len(fields) == 0 {
		return false
	}
	c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": gin.H{
		"code": "VALIDATION_ERROR", "message": "Проверьте заполненные поля.", "fields": fields,
	}})
	return true
}

func Fail(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}

func InternalError(c *gin.Context) {
	Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Внутренняя ошибка сервера.")
}
