import { DatePicker } from "./DatePicker";

export function DateTimeField({
  id,
  label,
  value,
  initialValue,
  onChange,
  onBlur,
  inputRef,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  initialValue: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  inputRef?: React.Ref<{ focus: () => void }>;
  error?: string;
  disabled?: boolean;
}) {
  const [day = "", time = ""] = value.split("T");
  const change = (date: string, clock: string) => {
    const next = date || clock ? `${date}T${clock}` : "";
    onChange(
      next.slice(0, 16) === initialValue.slice(0, 16) ? initialValue : next,
    );
  };
  return (
    <div className="date-time-field">
      <DatePicker
        id={id}
        label={label}
        value={day}
        onChange={(next) => change(next, time)}
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
          onChange={(event) => change(day, event.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
      </div>
    </div>
  );
}
