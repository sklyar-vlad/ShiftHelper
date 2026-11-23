import { CategoryName } from "@/entities/gig/GigCategory";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  acceptGigChange,
  rejectGigChange,
  withdrawGigChange,
  type Gig,
  type GigPoint,
  type CurrentUser,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";
import { formatDateTime, formatMoney } from "@/shared/lib/format";
import { GigForm } from "@/pages/create-gig/CreateGigPage";

const labels = {
  title: "Название",
  description: "Описание",
  requirements: "Требования",
  city: "Город",
  address: "Адрес",
  startsAt: "Начало",
  endsAt: "Окончание",
  amountKopecks: "Сумма за всё задание",
} as const;

function pointText(point?: GigPoint | null) {
  if (!point) return "Точка не указана";
  return (
    <>
      {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
      {point.source === "geoapify" && (
        <small className="muted">
          {" · "}
          {point.attribution}
          {" · "}
          <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">
            Geoapify
          </a>
        </small>
      )}
    </>
  );
}

export function TermsPanel({
  gig,
  user,
}: {
  gig: Gig;
  user: CurrentUser | null;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<Gig | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const owner = user?.id === gig.customer.id;
  const worker = !!user && user.id === gig.selectedWorker?.id;
  const change = gig.pendingChange;
  if (!owner && !worker) return null;
  async function decide(action: "accept" | "reject" | "withdraw") {
    if (busy.current || !change) return;
    busy.current = true;
    setWorking(true);
    setMessage("");
    try {
      const send = {
        accept: acceptGigChange,
        reject: rejectGigChange,
        withdraw: withdrawGigChange,
      }[action];
      await send(gig.id, change.id);
      await client.invalidateQueries();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Не удалось отправить решение. Попробуйте ещё раз.",
      );
      if (error instanceof ApiError && [403, 404, 409].includes(error.status))
        await client.invalidateQueries();
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  return (
    <section
      className="gig-application"
      aria-label="Условия задания"
      aria-busy={working}
    >
      {owner &&
        (editing ? (
          <GigForm
            gig={editing}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        ) : ["open", "in_progress"].includes(gig.status) && !change ? (
          <button
            className="button button-secondary"
            onClick={() => setEditing(gig)}
          >
            Изменить условия
          </button>
        ) : null)}
      {change && gig.status === "in_progress" && (
        <>
          <h2>Предложены новые условия</h2>
          <p className="notice">
            Действуют прежние условия. Изменения вступят в силу после согласия
            исполнителя. Сдать работу можно и без ответа на предложение.
          </p>
          <dl className="terms-comparison">
            <div>
              <dt>Категория</dt>
              <dd>
                <span className="small muted">Сейчас</span>
                <p className="gig-text">
                  <CategoryName code={gig.category} />
                </p>
              </dd>
              <dd>
                <span className="small muted">Предлагается</span>
                <p className="gig-text">
                  <CategoryName code={change.terms.category ?? gig.category} />
                </p>
              </dd>
            </div>
            {(gig.point || change.terms.point) && (
              <div>
                <dt>Точка на карте</dt>
                <dd>
                  <span className="small muted">Сейчас</span>
                  <p className="gig-text">{pointText(gig.point)}</p>
                </dd>
                <dd>
                  <span className="small muted">Предлагается</span>
                  <p className="gig-text">{pointText(change.terms.point)}</p>
                </dd>
              </div>
            )}
            {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => {
              const display = (value: string | number) =>
                key === "amountKopecks"
                  ? formatMoney(Number(value))
                  : key === "startsAt" || key === "endsAt"
                    ? formatDateTime(String(value))
                    : String(value) || "Не указано";
              return (
                <div key={key}>
                  <dt>{labels[key]}</dt>
                  <dd>
                    <span className="small muted">Сейчас</span>
                    <p className="gig-text">{display(gig[key])}</p>
                  </dd>
                  <dd>
                    <span className="small muted">Предлагается</span>
                    <p className="gig-text">{display(change.terms[key])}</p>
                  </dd>
                </div>
              );
            })}
          </dl>
          <div className="profile-actions">
            {worker ? (
              <>
                <button
                  className="button"
                  disabled={working}
                  onClick={() => void decide("accept")}
                >
                  Согласиться
                </button>
                <button
                  className="button button-secondary"
                  disabled={working}
                  onClick={() => void decide("reject")}
                >
                  Отказаться
                </button>
              </>
            ) : (
              <button
                className="button button-secondary"
                disabled={working}
                onClick={() => void decide("withdraw")}
              >
                Отозвать предложение
              </button>
            )}
          </div>
        </>
      )}
      {message && (
        <p role="alert" className="notice notice-error">
          {message}
        </p>
      )}
    </section>
  );
}
