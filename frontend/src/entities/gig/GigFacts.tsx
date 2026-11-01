import type { GigSummary } from "@/shared/api/generated/api";
import { formatDateTime, formatMoney } from "@/shared/lib/format";

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
          <dd>{gig.customer.name}</dd>
        </div>
      </dl>
    </>
  );
}
