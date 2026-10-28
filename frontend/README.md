# ShiftHelper frontend

React + TypeScript + Vite; зависимости и подход к структуре взяты из HackAeza.

```sh
npm ci
npm run dev
```

Для локального Vite API должен быть доступен по `http://localhost:8081`.
Другой адрес задаётся через `API_URL`. Документация проксируется через `SWAGGER_URL`
(по умолчанию `http://localhost:8080`). Для health probes Vite также проксирует `/healthz` и `/readyz`.
В Compose готовая сборка раздаётся nginx.

- `src/app` — запуск, маршрутизация и общие стили.
- `src/pages` — страницы.
- `src/widgets` — крупные блоки интерфейса.
- `src/entities` — компоненты сущностей по мере реализации.
- `src/shared` — API, UI, состояние и утилиты.

Контракт: `../docs/openapi.yaml`. После изменения запустите `npm run api`.
Файлы `src/shared/api/generated` создаёт Orval, их не редактируют вручную.
Проверки: `npm run lint`, `npm run build`, `npm run test:ci`.
