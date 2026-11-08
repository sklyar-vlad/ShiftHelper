# ShiftHelper

Платформа краткосрочных подработок: заказчик публикует задание и выбирает исполнителя, исполнитель сдаёт работу, заказчик подтверждает результат. Доступны профили, каталог, отклики, личные списки и взаимные отзывы.

Оплата сейчас происходит напрямую между участниками. Платежи через платформу, резервирование средств, документы самозанятых, чат и споры пока не реализованы.

## Требования

- Git, работающий Docker Engine или Docker Desktop и плагин Docker Compose с командой `docker compose`.
- Task v3: [установка](https://taskfile.dev/docs/installation). Для команд подготовки окружения нужен POSIX shell с `od`, `tr`, `grep`, `sed` и `chmod`.
- На Windows выполняйте команды в WSL; включите интеграцию Docker Desktop с нужным дистрибутивом и запустите Docker Desktop.
- Go и Node.js на хосте для запуска через Docker не нужны.
- Свободные порты по умолчанию: 80 (сайт), 5432 (PostgreSQL на localhost), 9090 (Prometheus на localhost).

Проверенный набор: Task 3.54.0 и Docker Compose 5.6.0. Нужна поддержка `up --wait` и зависимостей `service_healthy` / `service_completed_successfully`.

## Запуск

```sh
git clone https://github.com/sklyar-vlad/ShiftHelper.git
cd ShiftHelper
git switch dev
task env
task up
```

`task env` создаёт локальный `infra/.env` и генерирует пароль БД и токен метрик. Повторный вызов сохраняет уже заданные значения. Файл исключён из Git; не публикуйте его.

Сайт: http://shifthelper.localhost. Swagger: http://shifthelper.localhost/docs/swagger.html. Готовность API: http://shifthelper.localhost/readyz. Для начала зарегистрируйте аккаунт с нужной ролью.

Если порты заняты, измените `TRAEFIK_HTTP_PORT`, `POSTGRES_PORT`, `PROMETHEUS_PORT` в `infra/.env` до запуска. При смене HTTP-порта, например на 8088, адрес сайта станет `http://shifthelper.localhost:8088`; добавьте `APP_ORIGIN=http://shifthelper.localhost:8088` в тот же файл. Не меняйте `HTTP_PORT`: это внутренний порт API.

Для отдельного экземпляра задайте `COMPOSE_PROJECT_NAME` в окружении оболочки, например `export COMPOSE_PROJECT_NAME=shifthelper-check`, и назначьте свободные порты. Используйте это имя для всех последующих команд экземпляра. По умолчанию имя проекта — `shifthelper`.

## Статус, логи и остановка

```sh
docker compose --env-file infra/.env -f infra/compose.yaml ps
docker compose --env-file infra/.env -f infra/compose.yaml logs --tail 100 backend frontend traefik
docker compose --env-file infra/.env -f infra/compose.yaml stop
task up
```

`stop` останавливает сервисы без удаления данных; `task up` запускает их снова. `task down` удаляет контейнеры и сеть, сохраняя тома. Не используйте `down --volumes`, если данные нужны.

Миграции применяются автоматически до запуска API. Проверка: `task migrate:status`.

## Необязательные демоданные

Для заполнения примерами задайте собственные пароли, не вставляя их в команды или Git:

```sh
read -r -s -p 'Пароль демозаказчика: ' DEMO_CUSTOMER_PASSWORD; echo
read -r -s -p 'Пароль демоисполнителей: ' DEMO_WORKER_PASSWORD; echo
export DEMO_CUSTOMER_PASSWORD DEMO_WORKER_PASSWORD
task demo
unset DEMO_CUSTOMER_PASSWORD DEMO_WORKER_PASSWORD
```

Это команды Bash. Пароли должны соответствовать требованиям регистрации. Имена и email созданных демоаккаунтов выводит команда; используйте заданные вами пароли.

Разработка frontend: [frontend/README.md](frontend/README.md). Командные правила: [AGENTS.md](AGENTS.md). Дополнительные проверки: [docs/agents/development.md](docs/agents/development.md).
