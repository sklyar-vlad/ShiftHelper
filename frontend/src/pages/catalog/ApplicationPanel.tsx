import { useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  createApplication,
  withdrawApplication,
  submitGig,
  type CurrentUser,
  type Gig,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";
import { CustomerActions } from "@/widgets/applications/CustomerActions";
import { applicationStatusText } from "@/entities/gig/GigFacts";

export function ApplicationPanel({
  gig,
  user,
  refresh,
}: {
  gig: Gig;
  user: CurrentUser | null;
  refresh: () => Promise<unknown>;
}) {
  const location = useLocation();
  const client = useQueryClient();
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const application = gig.myApplication;

  async function send(action: "apply" | "withdraw" | "submit") {
    if (busy.current) return;
    if (action === "apply" && Array.from(comment.trim()).length > 1000) {
      setMessage("Комментарий должен содержать не больше 1000 символов.");
      return;
    }
    busy.current = true;
    setWorking(true);
    setMessage("");
    try {
      if (action === "withdraw")
        await withdrawApplication(gig.id, application!.id);
      else if (action === "submit") await submitGig(gig.id);
      else await createApplication(gig.id, { comment: comment.trim() });
      setComment("");
      await refresh();
      await client.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== `/api/v1/gigs/${gig.id}`,
      });
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? (error.details?.fields?.comment?.[0] ?? error.message)
          : "Не удалось связаться с сервисом. Попробуйте ещё раз.",
      );
      if (error instanceof ApiError && [403, 404, 409].includes(error.status)) {
        await refresh();
        await client.invalidateQueries({
          predicate: (query) => query.queryKey[0] !== `/api/v1/gigs/${gig.id}`,
        });
      }
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  if (!user)
    return (
      <section className="gig-application">
        <p>Войдите как исполнитель, чтобы откликнуться.</p>
        <Link
          className="button"
          to="/login"
          state={{ from: location.pathname + location.search }}
        >
          Войти
        </Link>
      </section>
    );
  if (user.role !== "worker")
    return user.id === gig.customer.id ? (
      <CustomerActions gig={gig} />
    ) : (
      <p className="notice">Отклик доступен только исполнителям.</p>
    );
  return (
    <section className="gig-application" aria-busy={working}>
      {application ? (
        <>
          <h2>Ваш отклик</h2>
          <p role="status">
            {applicationStatusText(application.status, gig.status)}
          </p>
          {application.comment && (
            <p className="gig-text">{application.comment}</p>
          )}
          {application.status === "pending" && gig.status === "open" && (
            <button
              className="button button-secondary"
              disabled={working}
              onClick={() => void send("withdraw")}
            >
              {working ? "Отзываем…" : "Отозвать отклик"}
            </button>
          )}
        </>
      ) : gig.status === "open" ? (
        <form
          aria-label="Отклик на задание"
          onSubmit={(event) => {
            event.preventDefault();
            void send("apply");
          }}
        >
          <div className="form-field">
            <label htmlFor="application-comment">
              Комментарий (необязательно)
            </label>
            <textarea
              id="application-comment"
              rows={3}
              maxLength={1000}
              value={comment}
              disabled={working}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
          <button className="button" type="submit" disabled={working}>
            {working ? "Отправляем…" : "Откликнуться"}
          </button>
        </form>
      ) : (
        <p>Задание больше не принимает отклики.</p>
      )}
      {gig.status === "in_progress" && gig.selectedWorker?.id === user.id && (
        <button
          className="button"
          disabled={working}
          onClick={() => void send("submit")}
        >
          {working ? "Сдаём работу…" : "Работа выполнена"}
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
