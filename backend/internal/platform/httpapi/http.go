package httpapi

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func ValidUUID(value string) bool { return uuidPattern.MatchString(value) }

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
