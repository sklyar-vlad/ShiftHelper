import { useState, type PointerEvent } from "react";

export type ClockTime = { hour: number; minute: number };

const padTime = (value: number) => String(value).padStart(2, "0");

export function formatClockTime({ hour, minute }: ClockTime) {
  return `${padTime(hour)}:${padTime(minute)}`;
}

const hours = Array.from({ length: 24 }, (_, index) => index);
const minutes = Array.from({ length: 12 }, (_, index) => index * 5);
const outerRadius = 41;
const innerRadius = 27;

function dialPosition(value: number, isHour: boolean) {
  const angle = (value / (isHour ? 12 : 60)) * 2 * Math.PI;
  const radius =
    isHour && (value === 0 || value > 12) ? innerRadius : outerRadius;
  return {
    left: `${50 + Math.sin(angle) * radius}%`,
    top: `${50 - Math.cos(angle) * radius}%`,
  };
}

export function DateTimeClock({
  time,
  onChange,
}: {
  time: ClockTime;
  onChange: (time: ClockTime) => void;
}) {
  const [unit, setUnit] = useState<keyof ClockTime>("hour");
  const isHour = unit === "hour";
  const value = time[unit];
  const max = isHour ? 23 : 59;
  const setValue = (next: number) => onChange({ ...time, [unit]: next });

  function selectAtPointer(event: PointerEvent<HTMLDivElement>) {
    const { left, top, width, height } =
      event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - left) / width - 0.5;
    const y = (event.clientY - top) / height - 0.5;
    const radius = Math.hypot(x, y) * 100;
    if (radius < 8) return;

    const steps = isHour ? 12 : 60;
    const angle = Math.atan2(x, -y) / (2 * Math.PI);
    const tick = (Math.round(angle * steps) + steps) % steps;
    if (!isHour) {
      setValue(tick);
    } else if (radius < (innerRadius + outerRadius) / 2) {
      setValue(tick === 0 ? 0 : tick + 12);
    } else {
      setValue(tick || 12);
    }
  }

  return (
    <div className="date-time-clock">
      <div className="date-time-clock-values">
        <button
          type="button"
          aria-pressed={isHour}
          onClick={() => setUnit("hour")}
        >
          <span>{padTime(time.hour)}</span>
          Часы
        </button>
        <button
          type="button"
          aria-pressed={!isHour}
          onClick={() => setUnit("minute")}
        >
          <span>{padTime(time.minute)}</span>
          Минуты
        </button>
      </div>
      <div
        className="date-time-dial"
        role="slider"
        tabIndex={0}
        data-picker-focus
        aria-label={isHour ? "Часы на циферблате" : "Минуты на циферблате"}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={padTime(value)}
        onKeyDown={(event) => {
          switch (event.key) {
            case "ArrowRight":
            case "ArrowUp":
              setValue((value + 1) % (max + 1));
              break;
            case "ArrowLeft":
            case "ArrowDown":
              setValue((value + max) % (max + 1));
              break;
            case "Home":
              setValue(0);
              break;
            case "End":
              setValue(max);
              break;
            case "Enter":
            case " ":
              if (isHour) setUnit("minute");
              break;
            default:
              return;
          }
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          const dial = event.currentTarget;
          const label = (event.target as HTMLElement).closest(
            "[data-clock-value]",
          );
          event.preventDefault();
          dial.focus();
          dial.setPointerCapture(event.pointerId);
          if (label) {
            setValue(Number(label.getAttribute("data-clock-value")));
          } else {
            selectAtPointer(event);
          }
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            selectAtPointer(event);
          }
        }}
        onPointerUp={(event) => {
          const dial = event.currentTarget;
          if (!dial.hasPointerCapture(event.pointerId)) return;
          dial.releasePointerCapture(event.pointerId);
          if (isHour) setUnit("minute");
        }}
      >
        <span
          className="date-time-hand"
          data-between-ticks={(!isHour && value % 5 !== 0) || undefined}
          style={{
            height: `${isHour && (value === 0 || value > 12) ? innerRadius : outerRadius}%`,
            transform: `rotate(${(value / (isHour ? 12 : 60)) * 360}deg)`,
          }}
          aria-hidden="true"
        />
        {(isHour ? hours : minutes).map((tick) => (
          <span
            key={tick}
            className="date-time-tick"
            data-clock-value={tick}
            data-selected={value === tick || undefined}
            style={dialPosition(tick, isHour)}
            aria-hidden="true"
          >
            {isHour && tick !== 0 ? tick : padTime(tick)}
          </span>
        ))}
      </div>
    </div>
  );
}
