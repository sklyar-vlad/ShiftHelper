import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  cancelGig,
  confirmGig,
  selectApplication,
  getListGigApplicationsQueryKey,
  useListGigApplications,
  type Gig,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";
import { UserCard } from "@/entities/user/UserCard";
import { StatusPanel } from "@/shared/ui/StatusPanel";
import { useSession } from "@/shared/model/session";

export function CustomerActions({ gig }: { gig: Gig }) {
  const { user } = useSession();
  const client = useQueryClient();
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const params = { status: "pending" as const, page, pageSize: 20 };
  const query = useListGigApplications(gig.id, params, {
    query: {
      enabled: gig.status === "open" && user?.id === gig.customer.id,
      retry: false,
      queryKey: [...getListGigApplicationsQueryKey(gig.id, params), user?.id],
    },
  });

  async function run(question: string, action: () => Promise<unknown>) {
    if (busy.current || !window.confirm(question)) return;
    busy.current = true;
    setWorking(true);
    setMessage("");
    try {
      await action();
      await client.invalidateQueries();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Не удалось связаться с сервисом. Попробуйте ещё раз.",
      );
      if (error instanceof ApiError && [403, 404, 409].includes(error.status))
        await client.invalidateQueries();
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return (
    <section className="gig-application" aria-busy={working}>
      <p className="small muted">Это ваше задание.</p>
      {gig.status === "open" && (
        <>
          <button
            className="button button-secondary"
            disabled={working}
            onClick={() =>
              void run(
                "Отменить задание? Ожидающие отклики будут отклонены.",
                () => cancelGig(gig.id),
              )
            }
          >
            Отменить задание
          </button>
          <h2>Ожидающие отклики</h2>
          {query.isPending ? (
            <StatusPanel title="Загружаем отклики" pending />
          ) : query.isError ? (
            <StatusPanel
              title="Не удалось загрузить отклики"
              retry={() => void query.refetch()}
            />
          ) : (
            <>
              {query.data.items.length ? (
                query.data.items.map((application) => (
                  <article
                    className="step-card application-card"
                    key={application.id}
                  >
                    <UserCard user={application.worker} />
                    <p className="gig-text">
                      {application.comment || "Без комментария"}
                    </p>
                    {(application.termsVersion ?? 1) !==
                      (gig.termsVersion ?? 1) && (
                      <p className="notice">
                        Кандидат ещё не подтвердил новые условия.
                      </p>
                    )}
                    <button
                      className="button"
                      disabled={
                        working ||
                        (application.termsVersion ?? 1) !==
                          (gig.termsVersion ?? 1)
                      }
                      onClick={() =>
                        void run(
                          `Выбрать исполнителя «${application.worker.name}»? Остальные ожидающие отклики будут отклонены.`,
                          () => selectApplication(gig.id, application.id),
                        )
                      }
                    >
                      Выбрать исполнителя
                    </button>
                  </article>
                ))
              ) : (
                <p className="muted">Ожидающих откликов нет.</p>
              )}
              {(page > 1 || query.data.total > 20) && (
                <nav
                  className="catalog-pagination"
                  aria-label="Страницы откликов"
                >
                  {page > 1 && (
                    <button
                      className="button button-secondary"
                      disabled={working}
                      onClick={() => setPage(page - 1)}
                    >
                      Назад
                    </button>
                  )}
                  <span>Страница {page}</span>
                  {page * 20 < query.data.total && (
                    <button
                      className="button button-secondary"
                      disabled={working}
                      onClick={() => setPage(page + 1)}
                    >
                      Далее
                    </button>
                  )}
                </nav>
              )}
            </>
          )}
        </>
      )}
      {gig.status === "awaiting_confirmation" && (
        <button
          className="button"
          disabled={working}
          onClick={() =>
            void run(
              "Подтвердить, что работа выполнена? Задание будет завершено.",
              () => confirmGig(gig.id),
            )
          }
        >
          Подтвердить выполнение
        </button>
      )}
      {message && (
        <p className="notice notice-error" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
