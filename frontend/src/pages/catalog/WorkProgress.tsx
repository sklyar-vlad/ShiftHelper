import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  advanceGigProgress,
  submitGig,
  type Gig,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";

const stages = [
  "Исполнитель выбран",
  "На месте",
  "Работа начата",
  "Работа сдана",
  "Работа подтверждена",
];
const actions = ["Я на месте", "Начал работу", "Работа выполнена"];

export function WorkProgress({
  gig,
  viewerId,
  refresh,
}: {
  gig: Gig;
  viewerId?: string;
  refresh: () => Promise<unknown>;
}) {
  const client = useQueryClient();
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const isWorker = !!viewerId && gig.selectedWorker?.id === viewerId;
  if (
    !gig.selectedWorker ||
    (!isWorker && viewerId !== gig.customer.id) ||
    gig.status === "open" ||
    gig.status === "cancelled"
  )
    return null;

  const stage =
    gig.status === "completed"
      ? 4
      : gig.status === "awaiting_confirmation"
        ? 3
        : gig.workStage === "started"
          ? 2
          : gig.workStage === "arrived"
            ? 1
            : 0;

  async function advance() {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setMessage("");
    try {
      if (stage === 2) await submitGig(gig.id);
      else
        await advanceGigProgress(gig.id, {
          stage: stage === 0 ? "arrived" : "started",
        });
      await refresh();
      if (stage === 2)
        void client.invalidateQueries({
          predicate: (query) => query.queryKey[0] !== `/api/v1/gigs/${gig.id}`,
        });
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Не удалось сохранить этап. Попробуйте ещё раз.",
      );
      if (error instanceof ApiError && [403, 404, 409].includes(error.status))
        await refresh();
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return (
    <section className="gig-application" aria-label="Ход выполнения">
      <h2>Ход выполнения</h2>
      <p role="status">Текущий этап: {stages[stage]}</p>
      <ol className="work-progress">
        {stages.map((label, index) => (
          <li key={label} aria-current={index === stage ? "step" : undefined}>
            {label}
          </li>
        ))}
      </ol>
      {isWorker && stage < 3 && (
        <button
          type="button"
          className="button"
          disabled={working}
          onClick={() => void advance()}
        >
          {working ? "Сохраняем…" : actions[stage]}
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
