package config

import (
	"os"
	"time"
)

type Config struct {
	Server   Server
	Database Database
	Redis    Redis
}
type Redis struct{ URL string }
type Database struct {
	URL            string
	MaxConnections int32
	ConnectTimeout time.Duration
}
type Server struct {
	Port              string
	ReadTimeout       time.Duration
	ReadHeaderTimeout time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration
}

func NewConfig() Config {
	port := os.Getenv("HTTP_PORT")
	if port == "" {
		port = "8081"
	}
	return Config{
		Database: Database{URL: os.Getenv("POSTGRES_URL"), MaxConnections: 10, ConnectTimeout: 5 * time.Second},
		Redis:    Redis{URL: os.Getenv("REDIS_URL")},
		Server:   Server{Port: port, ReadTimeout: 30 * time.Second, ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: time.Minute, ShutdownTimeout: 5 * time.Second},
	}
}
