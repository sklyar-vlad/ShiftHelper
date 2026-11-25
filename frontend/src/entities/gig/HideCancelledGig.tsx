import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  getGetCurrentUserQueryKey,
  getGetGigQueryKey,
  getListMyGigsQueryKey,
  hideMyGig,
  type CurrentUser,
  type Gig,
  type GigPage,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";

export function HideCancelledGig({
  gigId,
  userId,
  onHidden,
}: {
  gigId: string;
  userId: string;
  onHidden: () => void;
}) {
  const client = useQueryClient();
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  async function hide() {
    if (
      busy.current ||
      !window.confirm(
        "Задание исчезнет из ваших списков. История других участников сохранится.",
      )
    )
      return;

    busy.current = true;
    setWorking(true);
    setMessage("");
    try {
      await hideMyGig(gigId);
      if (
        client.getQueryData<CurrentUser>(getGetCurrentUserQueryKey())?.id !==
        userId
      )
        return;

      const lists = {
        queryKey: getListMyGigsQueryKey(),
        predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
          queryKey.at(-1) === userId,
      };
      client.setQueryData<Gig>([...getGetGigQueryKey(gigId), userId], (gig) =>
        gig ? { ...gig, hiddenFromMyGigs: true } : undefined,
      );
      await client.cancelQueries(lists);
      client.removeQueries({ ...lists, type: "inactive" });
      client.setQueriesData<GigPage>({ ...lists, type: "active" }, (list) =>
        list?.items.some((gig) => gig.id === gigId)
          ? {
              ...list,
              items: list.items.filter((gig) => gig.id !== gigId),
              total: Math.max(0, list.total - 1),
            }
          : list,
      );
      void client.invalidateQueries(lists);
      onHidden();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Не удалось убрать задание. Попробуйте ещё раз.",
      );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return (
    <div className="gig-hide-action">
      <button
        className="button button-secondary button-small"
        type="button"
        disabled={working}
        onClick={() => void hide()}
      >
        {working ? "Убираем…" : "Убрать из моих заданий"}
      </button>
      {message && (
        <p className="small" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
