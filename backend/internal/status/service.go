package status

import "context"

type Database interface{ Ping(context.Context) error }
type Service struct{ database Database }

func NewService(database Database) *Service        { return &Service{database: database} }
func (s *Service) Ready(ctx context.Context) error { return s.database.Ping(ctx) }
