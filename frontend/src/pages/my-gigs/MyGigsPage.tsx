import { Link, useLocation, useSearchParams } from "react-router";
import {
  getListMyGigsQueryKey,
  useListMyGigs,
  getListMyApplicationsQueryKey,
  useListMyApplications,
  type CurrentUser,
  type ScopeParameter,
} from "@/shared/api/generated/api";
import { useSession } from "@/shared/model/session";
import { StatusPanel } from "@/shared/ui/StatusPanel";
import {
  GigFacts,
  gigStatusNames,
  applicationStatusText,
} from "@/entities/gig/GigFacts";
import "@/pages/catalog/catalog.css";

export function MyGigsPage() {
  const { user } = useSession();
  return user ? <PersonalGigs key={user.id} user={user} /> : null;
}

function PersonalGigs({ user }: { user: CurrentUser }) {
  const [search] = useSearchParams();
  const location = useLocation();
  const worker = user.role === "worker";
  const view =
    worker && search.get("view") !== "work" ? "applications" : "work";
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
  const gigs = useListMyGigs(params, {
    query: {
      enabled: view === "work",
      retry: false,
      queryKey: [...getListMyGigsQueryKey(params), user.id],
    },
  });
  const applications = useListMyApplications(params, {
    query: {
      enabled: worker && view === "applications",
      retry: false,
      queryKey: [...getListMyApplicationsQueryKey(params), user.id],
    },
  });
  const query = view === "applications" ? applications : gigs;
  const items =
    view === "applications"
      ? applications.data?.items.map((item) => ({
          gig: item.gig,
          application: item.application,
        }))
      : gigs.data?.items.map((gig) => ({ gig, application: null }));
  const url = (next: number, filter = scope, section = view) =>
    `/my-gigs?scope=${filter}${worker ? `&view=${section}` : ""}${next > 1 ? `&page=${next}` : ""}`;
  return (
    <>
      <header className="page-heading">
        <h1>Мои задания</h1>
        <Link className="button" to={worker ? "/catalog" : "/gigs/new"}>
          {worker ? "Найти подработку" : "Опубликовать задание"}
        </Link>
      </header>
      {worker && (
        <nav className="profile-actions" aria-label="Раздел кабинета">
          {(
            [
              ["applications", "Мои отклики"],
              ["work", "Назначенные работы"],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              className={`button ${view === value ? "" : "button-secondary"}`}
              aria-current={view === value ? "page" : undefined}
              to={url(1, scope, value)}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
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
            {view === "applications" ? "Всего откликов" : "Всего заданий"}:{" "}
            {query.data.total}
          </p>
          {items?.length ? (
            <div className="catalog-grid">
              {items.map(({ gig, application }) => (
                <article className="gig-card" key={application?.id ?? gig.id}>
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
                  {application && (
                    <>
                      <p role="status">
                        {applicationStatusText(application.status, gig.status)}
                      </p>
                      {application.comment && (
                        <p className="gig-text">{application.comment}</p>
                      )}
                    </>
                  )}
                  {!worker && (
                    <p className="small">
                      Ожидают решения: {gig.pendingApplicationsCount}
                    </p>
                  )}
                  {!worker && gig.selectedWorker && (
                    <p className="small">
                      Исполнитель: {gig.selectedWorker.name}
                    </p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <section className="catalog-empty">
              <h2>
                {view === "applications"
                  ? "Откликов пока нет"
                  : "Заданий пока нет"}
              </h2>
              <p className="muted">
                {worker
                  ? "Здесь будут ваши отклики и назначенные работы в выбранном разделе."
                  : "Здесь будут ваши публикации в выбранном разделе."}
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
