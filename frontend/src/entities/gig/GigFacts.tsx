import type {
  ApplicationStatus,
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

export function GigFacts({ gig }: { gig: GigSummary }) {
  return (
    <>
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
            <UserCard user={gig.customer} />
          </dd>
        </div>
      </dl>
    </>
  );
}
