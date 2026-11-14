import { useId, useState } from "react";

const labels = ["Очень плохо", "Плохо", "Нормально", "Хорошо", "Отлично"];

export function StarRating({
  value,
  onChange,
  disabled = false,
}: {
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const [preview, setPreview] = useState<number | null>(null);
  const shownValue = disabled ? value : (preview ?? value);

  return (
    <fieldset
      className="star-rating"
      disabled={disabled}
      onMouseLeave={() => setPreview(null)}
      onKeyDown={(event) => {
        if (disabled || !(event.target instanceof HTMLInputElement)) return;
        const direction = ["ArrowRight", "ArrowDown"].includes(event.key)
          ? 1
          : ["ArrowLeft", "ArrowUp"].includes(event.key)
            ? -1
            : 0;
        if (!direction) return;
        event.preventDefault();
        const radios = Array.from(
          event.currentTarget.querySelectorAll<HTMLInputElement>(
            'input[type="radio"]',
          ),
        );
        const next =
          (radios.indexOf(event.target) + direction + radios.length) %
          radios.length;
        setPreview(null);
        radios[next]?.focus();
        onChange(next + 1);
      }}
    >
      <legend>Оценка</legend>
      <div className="star-rating-options">
        {labels.map((label, index) => {
          const rating = index + 1;
          return (
            <label
              key={rating}
              title={`${rating} из 5 — ${label}`}
              className={rating <= (shownValue ?? 0) ? "is-filled" : undefined}
              onMouseEnter={() => {
                if (!disabled) setPreview(rating);
              }}
            >
              <input
                type="radio"
                name={name}
                value={rating}
                checked={value === rating}
                onChange={() => {
                  setPreview(null);
                  onChange(rating);
                }}
              />
              <span aria-hidden="true">★</span>
              <span className="visually-hidden">{`${rating} из 5 — ${label}`}</span>
            </label>
          );
        })}
      </div>
      <p className="star-rating-caption" aria-live="polite">
        {shownValue
          ? `${shownValue} из 5 — ${labels[shownValue - 1]}`
          : "Выберите оценку"}
      </p>
    </fieldset>
  );
}
