import { useEffect, useRef, useState } from "react";
import { DatePicker } from "./DatePicker";
import { DateTimeClock, formatClockTime } from "./DateTimeClock";
import "./date-time-clock.css";

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
  const clock = time.slice(0, 5);
  const timeLabel = id === "startsAt" ? "Время начала" : "Время окончания";
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement>(null);

  function openClock(from: HTMLElement) {
    opener.current = from;
    setOpen(true);
  }

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
        separator="/"
        value={day}
        onChange={(next) => change(next, time)}
        onBlur={onBlur}
        inputRef={inputRef}
        error={error}
        disabled={disabled}
      />
      <div>
        <label htmlFor={`${id}-time`}>{timeLabel}</label>
        <div className="date-time-control">
          <input
            id={`${id}-time`}
            type="text"
            placeholder="чч:мм"
            maxLength={5}
            autoComplete="off"
            spellCheck={false}
            value={clock}
            onChange={(event) => change(day, event.target.value)}
            onBlur={onBlur}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            onKeyDown={(event) => {
              if (event.altKey && event.key === "ArrowDown") {
                event.preventDefault();
                openClock(event.currentTarget);
              }
            }}
          />
          <button
            type="button"
            aria-label={`${timeLabel}: открыть циферблат`}
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={disabled}
            onClick={(event) => openClock(event.currentTarget)}
          >
            <span className="date-time-clock-icon" aria-hidden="true" />
          </button>
        </div>
        {open && (
          <ClockDialog
            id={`${id}-clock`}
            label={timeLabel}
            clock={clock}
            onApply={(next) => change(day, next)}
            onClose={() => {
              setOpen(false);
              opener.current?.focus();
            }}
          />
        )}
      </div>
    </div>
  );
}

function ClockDialog({
  id,
  label,
  clock,
  onApply,
  onClose,
}: {
  id: string;
  label: string;
  clock: string;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [time, setTime] = useState(() => {
    if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) {
      const [hour, minute] = clock.split(":").map(Number);
      return { hour, minute };
    }
    const now = new Date();
    return { hour: now.getHours(), minute: now.getMinutes() };
  });

  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLElement>("[data-picker-focus]")?.focus();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="date-time-clock-dialog"
      aria-labelledby={id}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className="date-time-clock-content">
        <h2 id={id}>{label}</h2>
        <DateTimeClock time={time} onChange={setTime} />
        <div className="date-time-clock-actions">
          <button
            type="button"
            className="button button-small button-secondary"
            onClick={() => dialog.current?.close()}
          >
            Отмена
          </button>
          <button
            type="button"
            className="button button-small"
            onClick={() => {
              onApply(formatClockTime(time));
              dialog.current?.close();
            }}
          >
            Готово
          </button>
        </div>
      </div>
    </dialog>
  );
}
