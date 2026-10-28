import { Link } from "react-router";

export function StatusPanel({
  title,
  description,
  pending,
  retry,
}: {
  title: string;
  description?: string;
  pending?: boolean;
  retry?: () => void;
}) {
  return (
    <section className="status-panel" aria-busy={pending}>
      <span
        className={pending ? "spinner" : "status-symbol"}
        aria-hidden="true"
      >
        {pending ? "" : "↗"}
      </span>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      {retry ? (
        <button className="button" onClick={retry}>
          Попробовать ещё раз
        </button>
      ) : (
        !pending && (
          <Link className="button button-secondary" to="/">
            На главную
          </Link>
        )
      )}
    </section>
  );
}
