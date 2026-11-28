import { GigCategory } from "./GigCategory";
import type {
  ApplicationStatus,
  CancellationReason,
  GigStatus,
  GigSummary,
} from "@/shared/api/generated/api";
import { formatDateTime, formatMoney } from "@/shared/lib/format";
import { UserCard } from "@/entities/user/UserCard";

export const gigStatusNames = {
  open: "Открыто",
  in_progress: "В работе",
  awaiting_confirmation: "Ожидает подтверждения",
  completed: "Завершено",
  cancelled: "Отменено",
};

export const cancellationReasonNames: Record<CancellationReason, string> = {
  no_longer_needed: "Помощь больше не нужна",
  schedule_changed: "Изменились сроки",
  terms_changed: "Изменились условия или бюджет",
  posted_by_mistake: "Разместили по ошибке",
  other: "Другое",
};

const applicationStatuses = {
  pending: "Отклик ожидает решения заказчика.",
  selected: "Вы выбраны исполнителем.",
  rejected: "Отклик отклонён.",
  withdrawn: "Отклик отозван. Повторно откликнуться нельзя.",
};

export function applicationStatusText(
  status: ApplicationStatus,
  gigStatus: GigStatus,
) {
  if (status === "selected" && gigStatus === "awaiting_confirmation")
    return "Работа сдана. Ожидайте подтверждения заказчика.";
  if (status === "selected" && gigStatus === "completed")
    return "Работа завершена.";
  return applicationStatuses[status];
}

export function GigFacts({
  gig,
  viewerId,
}: {
  gig: GigSummary;
  viewerId?: string;
}) {
  return (
    <>
      <GigCategory code={gig.category} />
      <p className="gig-price">
        {formatMoney(gig.amountKopecks)} <span>за всё задание</span>
      </p>
      <dl className="gig-facts">
        <div>
          <dt>Город</dt>
          <dd>{gig.city}</dd>
        </div>
        <div>
          <dt>Начало</dt>
          <dd>
            <time dateTime={gig.startsAt}>{formatDateTime(gig.startsAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Окончание</dt>
          <dd>
            <time dateTime={gig.endsAt}>{formatDateTime(gig.endsAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Заказчик</dt>
          <dd>
            <UserCard user={gig.customer} viewerId={viewerId} />
          </dd>
        </div>
        {gig.cancellation && (
          <div>
            <dt>Причина отмены</dt>
            <dd>
              {gig.cancellation.reason
                ? cancellationReasonNames[gig.cancellation.reason]
                : "Причина не указана"}
              {gig.cancellation.comment && (
                <p className="gig-text">{gig.cancellation.comment}</p>
              )}
            </dd>
          </div>
        )}
      </dl>
    </>
  );
}
