package gigs

import (
	"slices"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/notifications"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/httpapi"
)

func notify(c *gin.Context, tx pgx.Tx, event notifications.Event, recipients ...string) bool {
	actor := auth.UserFromContext(c).ID
	recipients = slices.DeleteFunc(recipients, func(recipient string) bool {
		return recipient == "" || recipient == actor
	})
	if err := notifications.Record(c.Request.Context(), tx, event, recipients...); err != nil {
		httpapi.InternalError(c)
		return false
	}
	return true
}

func notificationRecipients(c *gin.Context, tx pgx.Tx, query string, args ...any) ([]string, bool) {
	rows, err := tx.Query(c.Request.Context(), query, args...)
	if err != nil {
		httpapi.InternalError(c)
		return nil, false
	}
	recipients, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		httpapi.InternalError(c)
		return nil, false
	}
	return recipients, true
}
