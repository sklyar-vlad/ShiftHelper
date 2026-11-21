import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Button } from "react-aria-components/Button";
import { Dialog, DialogTrigger } from "react-aria-components/Dialog";
import { Heading } from "react-aria-components/Heading";
import { Modal, ModalOverlay } from "react-aria-components/Modal";
import "./report.css";

const reasons = {
  fraud: "Подозрение на мошенничество",
  inappropriate: "Оскорбления или неприемлемое содержание",
  incorrect: "Неверные сведения",
  spam: "Спам",
  other: "Другое",
};
const commentLimit = 1000;

type Target = { type: "gig" | "user"; id: string; name: string };
type Report = {
  target: Target;
  reason: string;
  comment: string;
};

const submitDemoReport: (report: Report) => string = () =>
  "Демо: жалоба не отправлена и не сохранена.";

export function ReportAction({
  viewerId,
  target,
}: {
  viewerId: string | undefined;
  target: Target;
}) {
  if (!viewerId) return null;
  const title =
    target.type === "gig"
      ? "Пожаловаться на задание"
      : "Пожаловаться на пользователя";

  return (
    <DialogTrigger key={JSON.stringify([viewerId, target.type, target.id])}>
      <Button className="text-button report-trigger">{title}</Button>
      <ModalOverlay className="report-overlay">
        <Modal className="report-modal">
          <Dialog className="report-dialog">
            {({ close }) => (
              <ReportForm title={title} target={target} close={close} />
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

function ReportForm({
  title,
  target,
  close,
}: {
  title: string;
  target: Target;
  close: () => void;
}) {
  const id = useId();
  const [comment, setComment] = useState("");
  const [result, setResult] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (result) closeButton.current?.focus();
  }, [result]);
  const tooLong = Array.from(comment).length > commentLimit;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get("reason");
    if (typeof reason !== "string" || !Object.hasOwn(reasons, reason)) return;
    if (tooLong) {
      event.currentTarget.querySelector("textarea")?.focus();
      return;
    }
    setResult(submitDemoReport({ target, reason, comment }));
    setComment("");
  }

  return (
    <>
      <Heading slot="title" level={2}>
        {title}
      </Heading>
      <p className="report-target">
        {target.type === "gig" ? "Задание" : "Пользователь"} — {target.name}
      </p>
      {result ? (
        <>
          <p id={`${id}-result`} className="notice" role="status">
            {result}
          </p>
          <div className="report-actions">
            <button
              type="button"
              className="button"
              ref={closeButton}
              onClick={close}
              aria-describedby={`${id}-result`}
            >
              Закрыть
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="notice">
            Демо-режим: жалобы пока не отправляются модераторам.
          </p>
          <form aria-label={title} onSubmit={submit}>
            <div className="form-field">
              <label htmlFor={`${id}-reason`}>Причина</label>
              <select
                id={`${id}-reason`}
                name="reason"
                required
                defaultValue=""
                autoFocus
              >
                <option value="" disabled>
                  Выберите причину
                </option>
                {Object.entries(reasons).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor={`${id}-comment`}>
                Комментарий к жалобе (необязательно)
              </label>
              <textarea
                id={`${id}-comment`}
                rows={3}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                aria-invalid={tooLong}
                aria-describedby={`${id}-limit`}
              />
              <p
                id={`${id}-limit`}
                className={tooLong ? "field-error" : "field-hint"}
              >
                {tooLong
                  ? "Сократите комментарий до 1000 символов."
                  : "До 1000 символов."}
              </p>
            </div>
            <div className="report-actions">
              <Button className="button button-secondary" onPress={close}>
                Отмена
              </Button>
              <button className="button" type="submit">
                Отправить (демо)
              </button>
            </div>
          </form>
        </>
      )}
    </>
  );
}
