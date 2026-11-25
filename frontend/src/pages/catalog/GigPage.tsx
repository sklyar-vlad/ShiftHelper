import { TermsPanel } from "./TermsPanel";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { getGetGigQueryKey, useGetGig } from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";
import { PlaceMap } from "@/shared/ui/PlaceMap";
import { StatusPanel } from "@/shared/ui/StatusPanel";
import { GigFacts, gigStatusNames } from "@/entities/gig/GigFacts";
import { GigPointAttribution } from "@/entities/gig/GigPointAttribution";
import { GigPlaceWarning } from "@/entities/gig/GigPlaceWarning";
import { ReportAction } from "@/entities/report/ReportAction";
import { UserCard } from "@/entities/user/UserCard";
import { ReviewPanel } from "@/entities/review/ReviewPanel";
import { useSession } from "@/shared/model/session";
import { ApplicationPanel } from "./ApplicationPanel";
import "./catalog.css";

function CopyGigLink({ gigId }: { gigId: string }) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">(
    "idle",
  );

  async function copyLink() {
    if (status === "copying") return;
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/gigs/${encodeURIComponent(gigId)}`,
      );
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="gig-copy-link">
      <button
        type="button"
        className="button button-secondary button-small"
        disabled={status === "copying"}
        onClick={() => void copyLink()}
      >
        Скопировать ссылку
      </button>
      <span className="small muted" role="status">
        {status === "copied" && "Ссылка скопирована"}
        {status === "error" &&
          "Не удалось скопировать ссылку. Скопируйте адрес из строки браузера"}
      </span>
    </div>
  );
}

export function GigPage() {
  const { gigId = "" } = useParams();
  const location = useLocation();
  const session = useSession();
  const query = useGetGig(gigId, {
    query: {
      retry: false,
      enabled: !session.isPending && (!session.isError || !!session.user),
      queryKey: [...getGetGigQueryKey(gigId), session.user?.id ?? "guest"],
    },
  });
  const saved = location.state?.myGigs ?? location.state?.catalog;
  const backTo =
    typeof saved === "string" && /^\/(catalog|my-gigs)(\?|$)/.test(saved)
      ? saved
      : "/catalog";

  if (session.isError && !session.user)
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
      ) : !query.data ||
        (query.error instanceof ApiError &&
          [401, 403, 404].includes(query.error.status)) ? (
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
        <article className="gig-card gig-detail" key={gigId}>
          <span className="badge">{gigStatusNames[query.data.status]}</span>
          <h1>{query.data.title}</h1>
          <CopyGigLink key={gigId} gigId={query.data.id} />
          <GigFacts gig={query.data} viewerId={session.user?.id} />
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
          {query.data.address && query.data.point && (
            <div className="gig-place">
              <PlaceMap
                key={session.user?.id ?? "guest"}
                center={query.data.point}
                point={query.data.point}
                notice={<GigPlaceWarning point={query.data.point} />}
              />
              {query.data.point.source === "geoapify" && (
                <GigPointAttribution point={query.data.point} />
              )}
            </div>
          )}
          {query.data.selectedWorker && (
            <section>
              <h2>Выбранный исполнитель</h2>
              <UserCard
                user={query.data.selectedWorker}
                viewerId={session.user?.id}
              />
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
          {session.user?.id !== query.data.customer.id && (
            <ReportAction
              viewerId={session.user?.id}
              target={{
                type: "gig",
                id: query.data.id,
                name: query.data.title,
              }}
            />
          )}
          <TermsPanel
            key={`terms:${gigId}:${session.user?.id ?? "guest"}:${location.key}`}
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
                counterpart={
                  session.user.id === query.data.customer.id
                    ? query.data.selectedWorker
                    : query.data.customer
                }
              />
            )}
        </article>
      )}
    </>
  );
}
