import { Link, useSearchParams, useNavigate } from "react-router";
import { useListGigs } from "@/shared/api/generated/api";
import { useGigCategories } from "@/entities/gig/GigCategory";
import { StatusPanel } from "@/shared/ui/StatusPanel";
import { GigFacts } from "@/entities/gig/GigFacts";
import { CatalogFilters } from "./CatalogFilters";
import {
  readFilters,
  filterUrl,
  catalogQuery,
  catalogPage,
  emptyFilters,
  sortLabels,
  durationLabels,
  type Filters,
} from "./filters";
import "./catalog.css";

export function CatalogPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const filters = readFilters(search);
  const page = catalogPage(search);
  const categoryQuery = useGigCategories();
  const categories = Array.isArray(categoryQuery.data)
    ? categoryQuery.data
    : undefined;
  const validation = catalogQuery(
    filters,
    page,
    categories?.map((item) => item.code),
  );
  for (const key of Object.keys(emptyFilters) as (keyof Filters)[]) {
    if (search.getAll(key).length > 1)
      validation.errors[key] =
        "Параметр повторяется в ссылке. Примените фильтры заново.";
  }
  const valid = Object.keys(validation.errors).length === 0;
  const query = useListGigs(validation.params, {
    query: {
      retry: false,
      enabled: valid && (!filters.category || !!categories),
    },
  });
  const active = (Object.keys(emptyFilters) as (keyof Filters)[]).filter(
    (key) => filters[key] && filters[key] !== emptyFilters[key],
  );
  function chipLabel(key: keyof Filters) {
    switch (key) {
      case "q":
        return `Поиск: ${filters.q}`;
      case "city":
        return `Город: ${filters.city}`;
      case "category":
        return `Категория: ${categories?.find((item) => item.code === filters.category)?.name ?? filters.category}`;
      case "minPay":
        return `Оплата от: ${filters.minPay} ₽`;
      case "maxPay":
        return `Оплата до: ${filters.maxPay} ₽`;
      case "dateFrom":
        return `Начало от: ${filters.dateFrom}`;
      case "dateTo":
        return `Начало до: ${filters.dateTo}`;
      case "duration":
        return Object.hasOwn(durationLabels, filters.duration)
          ? durationLabels[filters.duration as keyof typeof durationLabels]
          : "Длительность";
      case "sort":
        return `Сортировка: ${Object.hasOwn(sortLabels, filters.sort) ? sortLabels[filters.sort as keyof typeof sortLabels] : filters.sort}`;
    }
  }

  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Найдите своё дело</p>
        <h1>Подработки</h1>
        <p className="muted">Открытые задания с оплатой за результат.</p>
      </header>
      <CatalogFilters
        key={search.toString()}
        initial={filters}
        categories={categories}
        loading={categoryQuery.isPending}
        retry={() => void categoryQuery.refetch()}
        onApply={(next) => void navigate(filterUrl(next))}
      />
      {(active.length > 0 || page > 1) && (
        <div className="catalog-active" aria-label="Применённые фильтры">
          {active.map((key) => (
            <Link
              className="catalog-chip"
              key={key}
              aria-label={`Убрать фильтр «${chipLabel(key)}»`}
              to={filterUrl({ ...filters, [key]: emptyFilters[key] })}
            >
              {chipLabel(key)} <span aria-hidden="true">×</span>
            </Link>
          ))}
          <Link className="text-link" to="/catalog">
            Сбросить всё
          </Link>
        </div>
      )}
      {!valid ? (
        <section className="notice notice-error" role="alert">
          <h2>Проверьте фильтры в ссылке</h2>
          <p>
            {Object.values(validation.errors).join(" ")} Исправьте значения и
            нажмите «Найти» или сбросьте фильтры.
          </p>
        </section>
      ) : filters.category && !categories ? (
        <StatusPanel
          title={
            categoryQuery.isPending
              ? "Загружаем категории"
              : "Не удалось загрузить категории"
          }
          pending={categoryQuery.isPending}
          retry={
            categoryQuery.isPending
              ? undefined
              : () => void categoryQuery.refetch()
          }
        />
      ) : query.isPending ? (
        <StatusPanel title="Загружаем подработки" pending />
      ) : query.isError ? (
        <StatusPanel
          title="Не удалось загрузить подработки"
          description="Проверьте соединение и попробуйте ещё раз."
          retry={() => void query.refetch()}
        />
      ) : (
        <>
          <p className="catalog-count" role="status">
            Найдено заданий: {query.data.total}
          </p>
          {query.data.items.length ? (
            <div className="catalog-grid">
              {query.data.items.map((gig) => (
                <article className="gig-card" key={gig.id}>
                  <span className="badge">Открыто</span>
                  <h2>
                    <Link
                      to={`/gigs/${gig.id}`}
                      state={{
                        catalog: `/catalog${search.size ? `?${search}` : ""}`,
                      }}
                    >
                      {gig.title}
                    </Link>
                  </h2>
                  <GigFacts gig={gig} />
                </article>
              ))}
            </div>
          ) : (
            <section className="catalog-empty">
              <h2>Заданий пока нет</h2>
              <p className="muted">
                Попробуйте изменить поиск или загляните позже.
              </p>
              {(active.length > 0 || page > 1) && (
                <Link className="button button-secondary" to="/catalog">
                  Все подработки
                </Link>
              )}
            </section>
          )}
          {(page > 1 || query.data.total > 20) && (
            <nav className="catalog-pagination" aria-label="Страницы каталога">
              {page > 1 && (
                <Link
                  className="button button-secondary"
                  to={filterUrl(filters, page - 1)}
                >
                  Назад
                </Link>
              )}
              <span aria-current="page">Страница {page}</span>
              {page * 20 < query.data.total && (
                <Link
                  className="button button-secondary"
                  to={filterUrl(filters, page + 1)}
                >
                  Далее
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
