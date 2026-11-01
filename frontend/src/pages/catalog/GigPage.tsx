import { Link, useLocation, useParams } from "react-router";
import { useGetGig } from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";
import { StatusPanel } from "@/shared/ui/StatusPanel";
import { GigFacts } from "@/entities/gig/GigFacts";
import "./catalog.css";

export function GigPage() {
  const { gigId = "" } = useParams();
  const location = useLocation();
  const query = useGetGig(gigId, { query: { retry: false } });
  const saved = location.state?.catalog;
  const catalog =
    typeof saved === "string" && /^\/catalog(\?|$)/.test(saved)
      ? saved
      : "/catalog";
  const statusNames = {
    open: "Открыто",
    in_progress: "В работе",
    awaiting_confirmation: "Ожидает подтверждения",
    completed: "Завершено",
    cancelled: "Отменено",
  };

  return (
    <>
      <Link className="text-link" to={catalog}>
        ← К подработкам
      </Link>
      {query.isPending ? (
        <StatusPanel title="Загружаем задание" pending />
      ) : query.isError ? (
        <StatusPanel
          title={
            query.error instanceof ApiError && query.error.status === 404
              ? "Задание недоступно"
              : "Не удалось загрузить задание"
          }
          description="Вернитесь в каталог или повторите попытку."
          retry={() => void query.refetch()}
        />
      ) : (
        <article className="gig-card gig-detail">
          <span className="badge">{statusNames[query.data.status]}</span>
          <h1>{query.data.title}</h1>
          <GigFacts gig={query.data} />
          <p className="small muted">
            Даты и время указаны в вашем часовом поясе.
          </p>
          <h2>Описание</h2>
          <p className="gig-text">{query.data.description}</p>
          {query.data.requirements && (
            <>
              <h2>Требования</h2>
              <p className="gig-text">{query.data.requirements}</p>
            </>
          )}
          <h2>Адрес</h2>
          <p className="gig-text">{query.data.address}</p>
        </article>
      )}
    </>
  );
}
