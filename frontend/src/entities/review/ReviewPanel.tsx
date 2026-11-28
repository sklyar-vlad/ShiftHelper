import { ReadonlyStars, StarRating } from "@/shared/ui/StarRating";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createGigReview,
  getGetCurrentUserQueryKey,
  getListGigReviewsQueryKey,
  useListGigReviews,
  type CurrentUser,
  type PublicUser,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";
import { roleNames } from "@/shared/model/session";
import { formatDateTime } from "@/shared/lib/format";
import "./review-panel.css";

export function ReviewPanel({
  gigId,
  user,
  counterpart,
}: {
  gigId: string;
  user: CurrentUser;
  counterpart?: PublicUser | null;
}) {
  const client = useQueryClient();
  const key = [...getListGigReviewsQueryKey(gigId), user.id];
  const query = useListGigReviews(gigId, {
    query: { queryKey: key, retry: false },
  });
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");

  async function send() {
    if (busy.current) return;
    if (score === null || !Number.isInteger(score) || score < 1 || score > 5) {
      setMessage("Выберите оценку от 1 до 5.");
      return;
    }
    if (Array.from(comment.trim()).length > 1000) {
      setMessage("Отзыв должен содержать не больше 1000 символов.");
      return;
    }
    busy.current = true;
    setWorking(true);
    setMessage("");
    try {
      const review = await createGigReview(gigId, {
        score,
        comment: comment.trim(),
      });
      if (
        client.getQueryData<CurrentUser | null>(getGetCurrentUserQueryKey())
          ?.id !== user.id
      )
        return;
      client.setQueryData(key, {
        items: [
          ...(query.data?.items ?? []).filter(
            (item) => item.authorId !== user.id,
          ),
          review,
        ],
      });
      setComment("");
      setSaved(true);
      await client.invalidateQueries();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? (error.details?.fields?.score?.[0] ??
              error.details?.fields?.comment?.[0] ??
              error.message)
          : "Не удалось связаться с сервисом. Попробуйте ещё раз.",
      );
      if (error instanceof ApiError && [403, 404, 409].includes(error.status)) {
        await client.invalidateQueries();
      }
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return (
    <section
      className="gig-application"
      aria-label="Оценки за работу"
      aria-busy={working}
    >
      <h2>Оценки за работу</h2>
      {saved && (
        <p className="review-success" role="status">
          Спасибо! Оценка сохранена.
        </p>
      )}
      {query.isPending ? (
        <p className="muted" role="status">
          Загружаем отзывы
        </p>
      ) : query.isError ? (
        <div className="notice notice-error">
          <p role="alert">Не удалось загрузить отзывы</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void query.refetch()}
          >
            Попробовать ещё раз
          </button>
        </div>
      ) : (
        <>
          <div className="review-cards">
            {[true, false].map((own) => {
              const title = own ? "Ваш отзыв" : "Отзыв другой стороны";
              const review = query.data.items.find(
                (item) => (item.authorId === user.id) === own,
              );
              const author = own
                ? user
                : counterpart?.id === review?.authorId
                  ? counterpart
                  : null;
              return (
                <article className="review-card" aria-label={title} key={title}>
                  <h3>{title}</h3>
                  {review ? (
                    <>
                      {author && (
                        <p>
                          <strong>{author.name}</strong> ·{" "}
                          {roleNames[author.role]}
                        </p>
                      )}
                      <time className="small muted" dateTime={review.createdAt}>
                        {formatDateTime(review.createdAt)}
                      </time>
                      <ReadonlyStars score={review.score} />
                      <p className="review-comment">
                        {review.comment.trim()
                          ? review.comment
                          : "Без комментария"}
                      </p>
                    </>
                  ) : (
                    <p className="small muted">Отзыв ещё не оставлен</p>
                  )}
                </article>
              );
            })}
          </div>
          {!query.data.items.some((review) => review.authorId === user.id) && (
            <form
              aria-label="Оценить вторую сторону"
              className="review-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <fieldset className="form-fields" disabled={working}>
                <p className="small muted">
                  Оцените вторую сторону. Отзыв нельзя изменить или отправить
                  повторно.
                </p>
                <StarRating
                  value={score}
                  onChange={setScore}
                  disabled={working}
                />
                <div className="form-field">
                  <label htmlFor="review-comment">Отзыв (необязательно)</label>
                  <textarea
                    id="review-comment"
                    rows={3}
                    maxLength={1000}
                    aria-describedby="review-comment-hint"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                  <p id="review-comment-hint" className="small muted">
                    Расскажите, как прошла работа. До 1000 символов.
                  </p>
                </div>
                <button
                  className="button"
                  type="submit"
                  disabled={working || score === null}
                >
                  {working ? "Отправляем…" : "Отправить оценку"}
                </button>
              </fieldset>
            </form>
          )}
        </>
      )}
      {message && (
        <p className="notice notice-error" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
