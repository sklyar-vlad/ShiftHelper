import { Link, useSearchParams } from "react-router";
import { useListGigs } from "@/shared/api/generated/api";
import { StatusPanel } from "@/shared/ui/StatusPanel";
import { GigFacts } from "@/entities/gig/GigFacts";
import "./catalog.css";

export function CatalogPage() {
  const [search, setSearch] = useSearchParams();
  const q = (search.get("q") ?? "").trim();
  const city = (search.get("city") ?? "").trim();
  const requestedPage = Number(search.get("page") ?? 1);
  const page =
    Number.isInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= 2147483647
      ? requestedPage
      : 1;
  const query = useListGigs(
    { q, city, page, pageSize: 20 },
    { query: { retry: false } },
  );

  function pageUrl(next: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (city) params.set("city", city);
    if (next > 1) params.set("page", String(next));
    return `/catalog${params.size ? `?${params}` : ""}`;
  }

  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Найдите своё дело</p>
        <h1>Подработки</h1>
        <p className="muted">Открытые задания с оплатой за результат.</p>
      </header>
      <form
        key={JSON.stringify([q, city])}
        className="catalog-filters"
        aria-label="Поиск подработок"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const params = new URLSearchParams();
          for (const field of ["q", "city"]) {
            const value = String(data.get(field) ?? "").trim();
            if (value) params.set(field, value);
          }
          setSearch(params);
        }}
      >
        <label>
          Название задания
          <input
            name="q"
            defaultValue={q}
            maxLength={150}
            placeholder="Например, помощь с переездом"
          />
        </label>
        <label>
          Город
          <input
            name="city"
            defaultValue={city}
            maxLength={100}
            placeholder="Например, Москва"
          />
        </label>
        <button className="button" type="submit">
          Найти
        </button>
        {(q || city) && (
          <Link className="text-link" to="/catalog">
            Сбросить
          </Link>
        )}
      </form>
      <p className="small muted">Даты и время указаны в вашем часовом поясе.</p>
      {query.isPending ? (
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
              {(q || city || page > 1) && (
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
                  to={pageUrl(page - 1)}
                >
                  Назад
                </Link>
              )}
              <span aria-current="page">Страница {page}</span>
              {page * 20 < query.data.total && (
                <Link
                  className="button button-secondary"
                  to={pageUrl(page + 1)}
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
