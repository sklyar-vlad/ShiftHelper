package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/auth"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/config"
	"github.com/sklyar-vlad/ShiftHelper/backend/internal/platform/postgres"
)

func demoID(n int) string { return fmt.Sprintf("d3e00000-0000-4000-8000-%012d", n) }

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	pool, err := postgres.New(ctx, config.NewConfig().Database)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Не удалось подключиться к PostgreSQL.")
		os.Exit(1)
	}
	defer pool.Close()
	if err := seed(ctx, pool, os.Getenv("DEMO_CUSTOMER_PASSWORD"), os.Getenv("DEMO_WORKER_PASSWORD"), time.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("Демоданные готовы. Заказчик: showcase.customer@example.test; исполнители: showcase.worker@example.test, showcase.worker2@example.test. Пароли взяты из окружения.")
}

func seed(ctx context.Context, pool *pgxpool.Pool, customerPassword, workerPassword string, now time.Time) error {
	for _, password := range []string{customerPassword, workerPassword} {
		if n := utf8.RuneCountInString(password); n < 8 || n > 128 {
			return errors.New("задайте DEMO_CUSTOMER_PASSWORD и DEMO_WORKER_PASSWORD: от 8 до 128 символов")
		}
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return errors.New("не удалось начать заполнение демоданными")
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(203020)"); err != nil {
		return errors.New("не удалось заблокировать повторный запуск")
	}
	for _, account := range []struct {
		n                                int
		email, role, name, bio, password string
	}{
		{1, "showcase.customer@example.test", "customer", "Мария — заказчик", "Организую мероприятия и ищу помощь с разовыми задачами.", customerPassword},
		{2, "showcase.worker@example.test", "worker", "Алексей — исполнитель", "Помогаю с переездами, сборкой мебели и работой на складе.", workerPassword},
		{3, "showcase.worker2@example.test", "worker", "Анна — исполнитель", "Есть опыт работы на мероприятиях и упаковки заказов.", workerPassword},
	} {
		var saved string
		err := tx.QueryRow(ctx, `INSERT INTO users (id, email, password_hash, role, name, bio) VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash
            WHERE users.email = EXCLUDED.email AND users.role = EXCLUDED.role RETURNING id::text`,
			demoID(account.n), account.email, auth.HashPassword(account.password), account.role, account.name, account.bio).Scan(&saved)
		if err != nil {
			return errors.New("не удалось создать демо-аккаунты: проверьте миграции и занятые showcase email/ID")
		}
	}
	type reply struct {
		worker          int
		status, comment string
	}
	for _, job := range []struct {
		n                                         int
		title, description, city, address, status string
		start, duration, amount, worker           int
		replies                                   []reply
	}{
		{101, "Помочь с переездом", "Упаковать вещи и перенести коробки из квартиры в машину. Тяжёлую мебель разбирать не нужно.", "Москва", "ул. Примерная, 12", "open", 24, 4, 600000, 0, []reply{{2, "pending", "Готов помочь, есть опыт переездов."}, {3, "pending", "Могу приехать к началу работы."}}},
		{102, "Подготовить площадку к мероприятию", "Расставить стулья, разложить материалы и помочь с регистрацией гостей.", "Санкт-Петербург", "Учебный проспект, 7", "open", 48, 8, 450000, 0, nil},
		{103, "Упаковать заказы небольшого магазина", "Проверить комплектацию и упаковать двадцать заказов. Материалы предоставляются.", "Казань", "Демонстрационная ул., 4", "open", 72, 5, 350000, 0, []reply{{3, "withdrawn", "Не смогу участвовать в этот день."}}},
		{104, "Собрать стеллажи в мастерской", "Собрать два стеллажа по инструкции, инструмент есть на месте.", "Новосибирск", "ул. Образцовая, 8", "in_progress", -1, 4, 500000, 2, []reply{{2, "selected", "Есть опыт сборки мебели."}, {3, "rejected", "Готова помочь с организацией."}}},
		{105, "Разобрать материалы после выставки", "Сложить многоразовые материалы и проверить комплектность оборудования.", "Екатеринбург", "Учебная площадь, 2", "awaiting_confirmation", -24, 4, 400000, 3, []reply{{3, "selected", "Знакома с работой на мероприятиях."}, {2, "rejected", "Могу помочь с погрузкой."}}},
		{106, "Помочь с расстановкой мебели", "Переставить столы и собрать рабочие места в небольшом офисе.", "Москва", "Тестовый переулок, 5", "completed", -72, 4, 450000, 2, []reply{{2, "selected", "Работаю аккуратно."}}},
		{107, "Подготовить товары к ярмарке", "Разложить товары и подготовить ценники. Организатор отменил участие в ярмарке.", "Казань", "ул. Примерная, 19", "cancelled", 36, 3, 300000, 0, []reply{{2, "rejected", "Готов помочь с подготовкой."}}},
	} {
		start := now.Add(time.Duration(job.start) * time.Hour)
		if job.status == "open" {
			start = now.UTC().Truncate(24 * time.Hour).Add(time.Duration(job.start+9) * time.Hour)
		}
		end := start.Add(time.Duration(job.duration) * time.Hour)
		result, err := tx.Exec(ctx, `INSERT INTO gigs (id, customer_id, title, description, requirements, city, address, starts_at, ends_at, amount_kopecks)
            VALUES ($1,$2,$3,$4,'',$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
			demoID(job.n), demoID(1), job.title, job.description, job.city, job.address, start, end, job.amount)
		if err != nil {
			return errors.New("не удалось создать демонстрационные задания")
		}
		if result.RowsAffected() == 0 {
			var owned bool
			if err := tx.QueryRow(ctx, "SELECT customer_id = $2 FROM gigs WHERE id = $1", demoID(job.n), demoID(1)).Scan(&owned); err != nil || !owned {
				return errors.New("ID демонстрационного задания занят чужой записью")
			}
			if job.status == "open" {
				if _, err := tx.Exec(ctx, "UPDATE gigs SET starts_at = $2, ends_at = $3 WHERE id = $1 AND status = 'open'", demoID(job.n), start, end); err != nil {
					return errors.New("не удалось обновить даты открытых демо-заданий")
				}
			}
			continue
		}
		for _, application := range job.replies {
			if _, err := tx.Exec(ctx, "INSERT INTO applications (id,gig_id,worker_id,status,comment) VALUES ($1,$2,$3,$4,$5)", demoID(job.n*10+application.worker), demoID(job.n), demoID(application.worker), application.status, application.comment); err != nil {
				return errors.New("не удалось создать демонстрационные отклики")
			}
		}
		var worker, submitted, completed, cancelled any
		if job.worker != 0 {
			worker = demoID(job.worker)
		}
		if job.status == "awaiting_confirmation" || job.status == "completed" {
			submitted = end
		}
		if job.status == "completed" {
			completed = end.Add(time.Hour)
		}
		if job.status == "cancelled" {
			cancelled = now.Add(-time.Hour)
		}
		if _, err := tx.Exec(ctx, "UPDATE gigs SET status=$2, selected_worker_id=$3, submitted_at=$4, completed_at=$5, cancelled_at=$6 WHERE id=$1", demoID(job.n), job.status, worker, submitted, completed, cancelled); err != nil {
			return errors.New("не удалось сохранить состояния демо-заданий")
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return errors.New("не удалось сохранить демонстрационные данные")
	}
	return nil
}
