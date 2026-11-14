import { DatePicker } from "./DatePicker";

export function DateTimeField({
  id,
  label,
  value,
  onChange,
  onBlur,
  inputRef,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  inputRef?: React.Ref<{ focus: () => void }>;
  error?: string;
  disabled?: boolean;
}) {
  const [day = "", time = ""] = value.split("T");
  return (
    <div className="date-time-field">
      <DatePicker
        id={id}
        label={label}
        value={day}
        onChange={(next) => onChange(`${next}T${time}`)}
        onBlur={onBlur}
        inputRef={inputRef}
        error={error}
        disabled={disabled}
      />
      <div>
        <label htmlFor={`${id}-time`}>
          {id === "startsAt" ? "Время начала" : "Время окончания"}
        </label>
        <input
          id={`${id}-time`}
          type="time"
          step="60"
          value={time.slice(0, 5)}
          onChange={(event) => onChange(`${day}T${event.target.value}`)}
          onBlur={onBlur}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
      </div>
    </div>
  );
}
