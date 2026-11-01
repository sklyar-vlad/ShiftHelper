import { Link, useLocation, useSearchParams } from "react-router";
import {
  getListMyGigsQueryKey,
  useListMyGigs,
  type ScopeParameter,
} from "@/shared/api/generated/api";
import { useSession } from "@/shared/model/session";
import { StatusPanel } from "@/shared/ui/StatusPanel";
import { GigFacts, gigStatusNames } from "@/entities/gig/GigFacts";
import "@/pages/catalog/catalog.css";

export function MyGigsPage() {
  const { user } = useSession();
  if (user?.role !== "customer")
    return (
      <StatusPanel
        title="Мои задания"
        description="Назначенные работы и отклики появятся здесь."
      />
    );
  return <CustomerGigs userId={user.id} />;
}

function CustomerGigs({ userId }: { userId: string }) {
  const [search] = useSearchParams();
  const location = useLocation();
  const requestedScope = search.get("scope");
  const scope: ScopeParameter =
    requestedScope === "history" || requestedScope === "all"
      ? requestedScope
      : "active";
  const requestedPage = Number(search.get("page") ?? 1);
  const page =
    Number.isInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= 2147483647
      ? requestedPage
      : 1;
  const params = { scope, page, pageSize: 20 };
  const query = useListMyGigs(params, {
    query: {
      retry: false,
      queryKey: [...getListMyGigsQueryKey(params), userId],
    },
  });
  const url = (next: number, filter = scope) =>
    `/my-gigs?scope=${filter}${next > 1 ? `&page=${next}` : ""}`;
  return (
    <>
      <header className="page-heading">
        <h1>Мои задания</h1>
        <Link className="button" to="/gigs/new">
          Опубликовать задание
        </Link>
      </header>
      <nav className="profile-actions" aria-label="Фильтр заданий">
        {(
          [
            ["active", "Активные"],
            ["history", "История"],
            ["all", "Все"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            className={`button ${scope === value ? "" : "button-secondary"}`}
            aria-current={scope === value ? "page" : undefined}
            to={url(1, value)}
          >
            {label}
          </Link>
        ))}
      </nav>
      <p className="small muted">Даты и время указаны в вашем часовом поясе.</p>
      {query.isPending ? (
        <StatusPanel title="Загружаем задания" pending />
      ) : query.isError ? (
        <StatusPanel
          title="Не удалось загрузить задания"
          retry={() => void query.refetch()}
        />
      ) : (
        <>
          <p className="catalog-count" role="status">
            Всего заданий: {query.data.total}
          </p>
          {query.data.items.length ? (
            <div className="catalog-grid">
              {query.data.items.map((gig) => (
                <article className="gig-card" key={gig.id}>
                  <span className="badge">{gigStatusNames[gig.status]}</span>
                  <h2>
                    <Link
                      to={`/gigs/${gig.id}`}
                      state={{ myGigs: location.pathname + location.search }}
                    >
                      {gig.title}
                    </Link>
                  </h2>
                  <GigFacts gig={gig} />
                  <p className="small">
                    Ожидают решения: {gig.pendingApplicationsCount}
                  </p>
                  {gig.selectedWorker && (
                    <p className="small">
                      Исполнитель: {gig.selectedWorker.name}
                    </p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <section className="catalog-empty">
              <h2>Заданий пока нет</h2>
              <p className="muted">
                Здесь будут ваши публикации в выбранном разделе.
              </p>
            </section>
          )}
          {(page > 1 || query.data.total > 20) && (
            <nav className="catalog-pagination" aria-label="Страницы заданий">
              {page > 1 && (
                <Link className="button button-secondary" to={url(page - 1)}>
                  Назад
                </Link>
              )}
              <span aria-current="page">Страница {page}</span>
              {page * 20 < query.data.total && (
                <Link className="button button-secondary" to={url(page + 1)}>
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
