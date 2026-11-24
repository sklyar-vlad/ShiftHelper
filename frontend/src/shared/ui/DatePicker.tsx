import { useState, useRef, useImperativeHandle } from "react";
import { parseDate, today, getLocalTimeZone } from "@internationalized/date";
import { DatePicker as AriaDatePicker } from "react-aria-components/DatePicker";
import { I18nProvider } from "react-aria-components/I18nProvider";
import { Label } from "react-aria-components/Label";
import { Group } from "react-aria-components/Group";
import { DateInput, DateSegment } from "react-aria-components/DateField";
import { Button } from "react-aria-components/Button";
import { Popover } from "react-aria-components/Popover";
import { Dialog } from "react-aria-components/Dialog";
import {
  Calendar,
  CalendarGrid,
  CalendarCell,
} from "react-aria-components/Calendar";
import { Heading } from "react-aria-components/Heading";
import { FieldError } from "react-aria-components/FieldError";
import "./date-picker.css";

function day(value?: string) {
  try {
    return value ? parseDate(value) : undefined;
  } catch {
    return undefined;
  }
}

export function DatePicker({
  value,
  onChange,
  label,
  id,
  name,
  min,
  max,
  disabled,
  error,
  onBlur,
  inputRef,
  separator,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
  name?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  error?: string;
  onBlur?: () => void;
  inputRef?: React.Ref<{ focus: () => void }>;
  separator?: string;
}) {
  const [open, setOpen] = useState(false);
  const segments = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useImperativeHandle(inputRef, () => ({
    focus: () =>
      segments.current
        ?.querySelector<HTMLElement>('[role="spinbutton"]')
        ?.focus(),
  }));
  const minimum = day(min),
    maximum = day(max);
  const currentDay = today(getLocalTimeZone());
  const todayDisabled = !!(
    (minimum && currentDay.compare(minimum) < 0) ||
    (maximum && currentDay.compare(maximum) > 0)
  );
  return (
    <I18nProvider locale="ru-RU">
      <AriaDatePicker
        className="date-picker"
        id={id}
        name={name}
        value={day(value) ?? null}
        onChange={(next) => onChange(next?.toString() ?? "")}
        minValue={minimum}
        maxValue={maximum}
        isDisabled={disabled}
        isInvalid={error ? true : undefined}
        validationBehavior="aria"
        granularity="day"
        isOpen={open}
        onOpenChange={setOpen}
        onBlur={onBlur}
        shouldForceLeadingZeros
      >
        <Label className="date-picker-label">{label}</Label>
        <Group className="date-picker-input">
          <DateInput className="date-picker-segments" ref={segments}>
            {(segment) => (
              <DateSegment
                segment={
                  separator && segment.type === "literal"
                    ? { ...segment, text: separator }
                    : segment
                }
                className="date-picker-segment"
              />
            )}
          </DateInput>
          {value && (
            <Button
              slot={null}
              className="date-picker-icon"
              aria-label={`Очистить дату: ${label}`}
              isDisabled={disabled}
              onPress={() => onChange("")}
            >
              ×
            </Button>
          )}
          <Button
            ref={trigger}
            onPress={() => trigger.current?.focus()}
            className="date-picker-icon"
            aria-label="Открыть календарь"
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <rect x="3" y="5" width="18" height="16" rx="3" />
              <path d="M8 3v4M16 3v4M3 11h18" />
            </svg>
          </Button>
        </Group>
        <FieldError id={id ? `${id}-error` : undefined} className="field-error">
          {error}
        </FieldError>
        <Popover
          className="date-picker-popover"
          placement="bottom start"
          offset={8}
          containerPadding={12}
        >
          <Dialog
            aria-label={`Выбор даты: ${label}`}
            className="date-picker-dialog"
          >
            <Calendar
              autoFocus
              firstDayOfWeek="mon"
              className="date-picker-calendar"
            >
              <header>
                <Button
                  slot="previous"
                  className="date-picker-nav"
                  aria-label="Предыдущий месяц"
                >
                  ←
                </Button>
                <Heading />
                <Button
                  slot="next"
                  className="date-picker-nav"
                  aria-label="Следующий месяц"
                >
                  →
                </Button>
              </header>
              <CalendarGrid weekdayStyle="short">
                {(date) => (
                  <CalendarCell date={date} className="date-picker-day" />
                )}
              </CalendarGrid>
            </Calendar>
            <footer>
              <Button
                slot={null}
                className="date-picker-today"
                isDisabled={todayDisabled}
                onPress={() => {
                  onChange(currentDay.toString());
                  setOpen(false);
                }}
              >
                Сегодня
              </Button>
              <Button
                slot={null}
                className="date-picker-done"
                onPress={() => setOpen(false)}
              >
                Готово
              </Button>
            </footer>
          </Dialog>
        </Popover>
      </AriaDatePicker>
    </I18nProvider>
  );
}
