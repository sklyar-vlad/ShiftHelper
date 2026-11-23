import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  cancelGig,
  confirmGig,
  selectApplication,
  getListGigApplicationsQueryKey,
  getGetCurrentUserQueryKey,
  getGetGigQueryKey,
  useListGigApplications,
  type Gig,
  type CurrentUser,
  type CancellationReason,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";
import { UserCard } from "@/entities/user/UserCard";
import { StatusPanel } from "@/shared/ui/StatusPanel";
import { useSession } from "@/shared/model/session";
import { cancellationReasonNames } from "@/entities/gig/GigFacts";

export function CustomerActions({ gig }: { gig: Gig }) {
  const { user } = useSession();
  const client = useQueryClient();
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [page, setPage] = useState(1);
  const params = { status: "pending" as const, page, pageSize: 20 };
  const query = useListGigApplications(gig.id, params, {
    query: {
      enabled: gig.status === "open" && user?.id === gig.customer.id,
      retry: false,
      queryKey: [...getListGigApplicationsQueryKey(gig.id, params), user?.id],
    },
  });

  async function run(action: () => Promise<unknown>, question?: string) {
    if (busy.current || (question && !window.confirm(question))) return;
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

  function submitCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") ?? "") as CancellationReason;
    const comment = String(data.get("comment") ?? "");
    if (!Object.hasOwn(cancellationReasonNames, reason)) return;
    if (Array.from(comment).length > 500) {
      setCommentError("Укажите пояснение до 500 символов.");
      event.currentTarget.querySelector("textarea")?.focus();
      return;
    }
    void run(async () => {
      const updated = await cancelGig(gig.id, { reason, comment });
      if (
        client.getQueryData<CurrentUser>(getGetCurrentUserQueryKey())?.id ===
        user?.id
      ) {
        client.setQueryData([...getGetGigQueryKey(gig.id), user?.id], updated);
      }
      setCancelling(false);
    });
  }

  return (
    <section className="gig-application" aria-busy={working}>
      <p className="small muted">Это ваше задание.</p>
      {gig.status === "open" && (
        <>
          {cancelling ? (
            <form
              className="profile-edit"
              aria-label="Отмена задания"
              onSubmit={submitCancellation}
            >
              <fieldset className="form-fields" disabled={working}>
                <p className="muted">Ожидающие отклики будут отклонены.</p>
                <div className="form-field">
                  <label htmlFor="cancellation-reason">Причина отмены</label>
                  <select
                    id="cancellation-reason"
                    name="reason"
                    defaultValue=""
                    required
                    autoFocus
                  >
                    <option value="" disabled>
                      Выберите причину
                    </option>
                    {Object.entries(cancellationReasonNames).map(
                      ([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="cancellation-comment">
                    Пояснение (необязательно)
                  </label>
                  <textarea
                    id="cancellation-comment"
                    name="comment"
                    rows={3}
                    aria-invalid={!!commentError}
                    aria-describedby="cancellation-comment-hint"
                    onChange={() => setCommentError("")}
                  />
                  <p
                    id="cancellation-comment-hint"
                    className={commentError ? "field-error" : "small muted"}
                    role={commentError ? "alert" : undefined}
                  >
                    {commentError || "До 500 символов"}
                  </p>
                </div>
                <div className="profile-actions">
                  <button className="button" type="submit">
                    {working ? "Отменяем…" : "Подтвердить отмену"}
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      setCancelling(false);
                      setCommentError("");
                      setMessage("");
                    }}
                  >
                    Не отменять
                  </button>
                </div>
              </fieldset>
            </form>
          ) : (
            <button
              className="button button-secondary"
              disabled={working}
              onClick={() => {
                setMessage("");
                setCancelling(true);
              }}
            >
              Отменить задание
            </button>
          )}
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
                    <UserCard user={application.worker} viewerId={user?.id} />
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
                          () => selectApplication(gig.id, application.id),
                          `Выбрать исполнителя «${application.worker.name}»? Остальные ожидающие отклики будут отклонены.`,
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
              () => confirmGig(gig.id),
              "Подтвердить, что работа выполнена? Задание будет завершено.",
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
