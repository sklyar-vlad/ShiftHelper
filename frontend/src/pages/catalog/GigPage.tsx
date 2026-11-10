import { TermsPanel } from "./TermsPanel";
import { Link, useLocation, useParams } from "react-router";
import { getGetGigQueryKey, useGetGig } from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";
import { StatusPanel } from "@/shared/ui/StatusPanel";
import { GigFacts, gigStatusNames } from "@/entities/gig/GigFacts";
import { UserCard } from "@/entities/user/UserCard";
import { ReviewPanel } from "@/entities/review/ReviewPanel";
import { useSession } from "@/shared/model/session";
import { ApplicationPanel } from "./ApplicationPanel";
import "./catalog.css";

export function GigPage() {
  const { gigId = "" } = useParams();
  const location = useLocation();
  const session = useSession();
  const query = useGetGig(gigId, {
    query: {
      retry: false,
      enabled: !session.isPending && !session.isError,
      queryKey: [...getGetGigQueryKey(gigId), session.user?.id ?? "guest"],
    },
  });
  const saved = location.state?.myGigs ?? location.state?.catalog;
  const backTo =
    typeof saved === "string" && /^\/(catalog|my-gigs)(\?|$)/.test(saved)
      ? saved
      : "/catalog";

  if (session.isError)
    return (
      <StatusPanel
        title="Не удалось проверить аккаунт"
        retry={() => void session.refresh()}
      />
    );

  return (
    <>
      <Link className="text-link" to={backTo}>
        {backTo.startsWith("/my-gigs")
          ? "← К моим заданиям"
          : "← К подработкам"}
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
          description={
            query.error instanceof ApiError && query.error.status === 404
              ? "Задание не найдено или больше недоступно. Возможно, его заняли или отменили."
              : "Вернитесь в каталог или повторите попытку."
          }
          retry={() => void query.refetch()}
        />
      ) : (
        <article className="gig-card gig-detail">
          <span className="badge">{gigStatusNames[query.data.status]}</span>
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
          {query.data.selectedWorker && (
            <section>
              <h2>Выбранный исполнитель</h2>
              <UserCard user={query.data.selectedWorker} />
            </section>
          )}
          {query.data.counterpartyContact !== undefined && (
            <section aria-label="Связь со второй стороной">
              <h2>
                Контакт{" "}
                {session.user?.role === "customer"
                  ? "исполнителя"
                  : "заказчика"}
              </h2>
              <p className="gig-text">
                {query.data.counterpartyContact ||
                  "Контакт пока не указан. Вторая сторона может добавить его в своём профиле."}
              </p>
            </section>
          )}
          <p className="notice">
            Оплата — напрямую между заказчиком и исполнителем по договорённости.
          </p>
          <TermsPanel
            key={`terms:${gigId}:${session.user?.id ?? "guest"}`}
            gig={query.data}
            user={session.user}
          />
          <ApplicationPanel
            key={`application:${gigId}:${session.user?.id ?? "guest"}`}
            gig={query.data}
            user={session.user}
            refresh={() => query.refetch()}
          />
          {query.data.status === "completed" &&
            session.user &&
            (session.user.id === query.data.customer.id ||
              session.user.id === query.data.selectedWorker?.id) && (
              <ReviewPanel
                key={`review:${gigId}:${session.user.id}`}
                gigId={gigId}
                user={session.user}
              />
            )}
        </article>
      )}
    </>
  );
}
