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
  return (
    <fieldset className="star-rating" disabled={disabled}>
      <legend>Оценка</legend>
      <div className="star-rating-options">
        {labels.map((label, index) => {
          const rating = index + 1;
          return (
            <label key={rating} title={`${rating} из 5 — ${label}`}>
              <input
                type="radio"
                name="review-score"
                value={rating}
                checked={value === rating}
                onChange={() => onChange(rating)}
              />
              <span aria-hidden="true">★</span>
              <span className="visually-hidden">{`${rating} из 5 — ${label}`}</span>
            </label>
          );
        })}
      </div>
      <p className="star-rating-caption" aria-live="polite">
        {value ? `${value} из 5 — ${labels[value - 1]}` : "Выберите оценку"}
      </p>
    </fieldset>
  );
}
