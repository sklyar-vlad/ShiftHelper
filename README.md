<h1 align="center">ShiftHelper</h1>

<p align="center">
  Сервис краткосрочных подработок для заказчиков и исполнителей.
</p>

<p align="center">
  <a href="#возможности">Возможности</a> ·
  <a href="#демо">Демо</a> ·
  <a href="#быстрый-запуск">Быстрый запуск</a> ·
  <a href="#разработка">Разработка</a>
</p>

<p align="center">
  <a href="https://github.com/sklyar-vlad/ShiftHelper/actions/workflows/ci.yml">
    <img src="https://github.com/sklyar-vlad/ShiftHelper/actions/workflows/ci.yml/badge.svg?branch=dev" alt="Проверки ветки dev">
  </a>
</p>

## Возможности

| Заказчик | Исполнитель |
| --- | --- |
| Публикует задание, указывает время, оплату, адрес и точку на карте. | Ищет подработку по городу, категории, оплате и времени. |
| Сравнивает отклики и выбирает исполнителя. | Откликается на подходящее задание и следит за ответом. |
| Видит, на каком этапе работа, и подтверждает результат. | Отмечает прибытие и начало работы, затем сдаёт результат. |

Свои задания и отклики доступны в личном кабинете. Об изменениях приходят уведомления, а после подтверждения работы стороны могут оставить друг другу отзывы. Оплата происходит напрямую между участниками.

## Демо

> **Скриншот главной.** Здесь будет первый экран ShiftHelper с переходом в каталог.

| Формат | Что показать |
| --- | --- |
| GIF · Заказчик | Создаёт задание, проверяет точку на карте и публикует объявление. |
| GIF · Ход работы | Исполнитель отмечает этапы, а открытая карточка заказчика обновляется. |
| Скриншот · Мобильный экран | Каталог с фильтрами по городу и категории. |

## Быстрый запуск

Нужны Git, Docker с поддержкой `docker compose up --wait` и [Task v3](https://taskfile.dev/docs/installation). На Windows используйте WSL с включённой интеграцией Docker Desktop.

```sh
git clone https://github.com/sklyar-vlad/ShiftHelper.git
cd ShiftHelper
git switch dev
task up
```

[Открыть ShiftHelper](http://shifthelper.localhost/) · [Swagger](http://shifthelper.localhost/docs/swagger.html) · [Готовность API](http://shifthelper.localhost/readyz)

Для начала зарегистрируйте аккаунт заказчика или исполнителя. Чтобы пройти сценарий с обеих сторон, откройте второй аккаунт в приватном окне.

<details>
<summary>Локальное окружение, порты и логи</summary>

`task up` сам запускает `task env`. Эта команда создаёт локальный `infra/.env`, генерирует пароль БД и токен метрик, а при повторном запуске сохраняет заданные значения. Файл исключён из Git. Для подготовки окружения нужен POSIX shell с `od`, `tr`, `grep`, `sed` и `chmod`. Go и Node.js на хосте для запуска через Docker не нужны.

По умолчанию сайт использует порт 80, PostgreSQL — 5432, Prometheus — 9090. Если порт занят, задайте `TRAEFIK_HTTP_PORT`, `POSTGRES_PORT` или `PROMETHEUS_PORT` в `infra/.env`. При смене порта сайта обновите `APP_ORIGIN`, например на `http://shifthelper.localhost:8088`. `HTTP_PORT` задаёт внутренний порт API.

Миграции применяются перед запуском API. Их состояние показывает `task migrate:status`.

```sh
docker compose --env-file infra/.env -f infra/compose.yaml ps
docker compose --env-file infra/.env -f infra/compose.yaml logs --tail 100 backend frontend traefik
docker compose --env-file infra/.env -f infra/compose.yaml stop
```

`task up` снова запускает сервисы. `task down` удаляет контейнеры и сеть, сохраняя тома. Для отдельного экземпляра задайте свободные порты и используйте одно значение `COMPOSE_PROJECT_NAME` для всех его команд.

</details>

<details>
<summary>Заполнить стенд демоданными</summary>

Задайте свои пароли по правилам регистрации. Команды рассчитаны на Bash.

```bash
read -r -s -p 'Пароль демозаказчика: ' DEMO_CUSTOMER_PASSWORD; echo
read -r -s -p 'Пароль демоисполнителей: ' DEMO_WORKER_PASSWORD; echo
export DEMO_CUSTOMER_PASSWORD DEMO_WORKER_PASSWORD
task demo
unset DEMO_CUSTOMER_PASSWORD DEMO_WORKER_PASSWORD
```

`task demo` выводит имена и email демоаккаунтов. Для входа используйте пароли, которые ввели выше.

</details>

## Разработка

| Где | Что находится |
| --- | --- |
| [`frontend/`](frontend/) | Интерфейс на React, TypeScript и Vite. |
| [`backend/`](backend/) | API на Go и Gin, PostgreSQL через pgx, Redis и миграции Goose. |
| [`infra/`](infra/) | Docker Compose, nginx, Traefik и Prometheus. |
| [`docs/openapi.yaml`](docs/openapi.yaml) | Контракт API для Swagger и генерации TypeScript-клиента. |

[Запуск frontend](frontend/README.md) · [Проверки и настройка карты](docs/agents/development.md) · [Правила работы с проектом](AGENTS.md)
