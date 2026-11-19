import { useState } from "react";
import { RadioGroup, Radio } from "react-aria-components/RadioGroup";
import { Label } from "react-aria-components/Label";
import { Text } from "react-aria-components/Text";
import "./star-rating.css";

const descriptions = ["Очень плохо", "Плохо", "Нормально", "Хорошо", "Отлично"];

export function StarRating({
  value,
  onChange,
  disabled = false,
}: {
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState(0);
  return (
    <RadioGroup
      className="star-rating"
      value={value === null ? "" : String(value)}
      onChange={(next) => {
        setPreview(0);
        onChange(Number(next));
      }}
      isDisabled={disabled}
      isRequired
      validationBehavior="aria"
      orientation="horizontal"
    >
      <Label className="star-rating-label">Оценка</Label>
      <div className="star-rating-options" onMouseLeave={() => setPreview(0)}>
        {descriptions.map((description, index) => {
          const score = index + 1;
          return (
            <Radio
              key={score}
              value={String(score)}
              aria-label={`${score} из 5 — ${description}`}
              className="star-rating-option"
              data-filled={score <= (preview || value || 0)}
              onHoverStart={() => {
                if (!disabled) setPreview(score);
              }}
              onHoverEnd={() => setPreview(0)}
            >
              <StarIcon />
            </Radio>
          );
        })}
      </div>
      <Text slot="description" className="star-rating-description">
        {value === null ? "Выберите оценку от 1 до 5" : descriptions[value - 1]}
      </Text>
    </RadioGroup>
  );
}

function StarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.4l6.3-.9Z" />
    </svg>
  );
}

export function ReadonlyStars({ score }: { score: number }) {
  return (
    <div className="readonly-stars">
      <span aria-hidden="true" className="star-rating-options">
        {descriptions.map((description, index) => (
          <span
            key={description}
            className="star-rating-mark"
            data-filled={index < score}
          >
            <StarIcon />
          </span>
        ))}
      </span>
      <span className="small muted">{score} из 5</span>
    </div>
  );
}
