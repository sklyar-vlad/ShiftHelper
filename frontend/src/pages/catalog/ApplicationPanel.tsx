import { useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  createApplication,
  withdrawApplication,
  type CurrentUser,
  type Gig,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";

const applicationStatuses = {
  pending: "Отклик ожидает решения заказчика.",
  selected: "Вы выбраны исполнителем.",
  rejected: "Отклик отклонён.",
  withdrawn: "Отклик отозван. Повторно откликнуться нельзя.",
};

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

  async function send(withdrawing: boolean) {
    if (busy.current) return;
    if (!withdrawing && Array.from(comment.trim()).length > 1000) {
      setMessage("Комментарий должен содержать не больше 1000 символов.");
      return;
    }
    busy.current = true;
    setWorking(true);
    setMessage("");
    try {
      if (withdrawing && application)
        await withdrawApplication(gig.id, application.id);
      else await createApplication(gig.id, { comment: comment.trim() });
      setComment("");
      await refresh();
      void client.invalidateQueries({ queryKey: ["/api/v1/gigs"] });
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? (error.details?.fields?.comment?.[0] ?? error.message)
          : "Не удалось связаться с сервисом. Попробуйте ещё раз.",
      );
      if (
        error instanceof ApiError &&
        (error.status === 409 || error.status === 404)
      )
        await refresh();
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
    return (
      <p className="notice">
        {user.id === gig.customer.id
          ? "Это ваше задание."
          : "Отклик доступен только исполнителям."}
      </p>
    );
  return (
    <section className="gig-application" aria-busy={working}>
      {application ? (
        <>
          <h2>Ваш отклик</h2>
          <p role="status">{applicationStatuses[application.status]}</p>
          {application.comment && (
            <p className="gig-text">{application.comment}</p>
          )}
          {application.status === "pending" && gig.status === "open" && (
            <button
              className="button button-secondary"
              disabled={working}
              onClick={() => void send(true)}
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
            void send(false);
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
      {message && (
        <p className="notice notice-error" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
