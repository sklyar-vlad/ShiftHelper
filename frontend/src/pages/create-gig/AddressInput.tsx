import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import {
  suggestGigPlaces,
  type SuggestGigPlaces200Item as AddressSuggestion,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";

type Props = Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "onSelect"
> & {
  city: string;
  value: string;
  onValueChange: (value: string) => void;
  onChoose: (suggestion: AddressSuggestion, value: string) => void;
};

type AddressLookup = {
  city: string;
  address: string;
  revision: number;
  options: AddressSuggestion[];
  message?: string;
};

const delayMs = 500;
const rateMessage =
  "Слишком много запросов. Сделайте паузу или введите адрес вручную.";

export function AddressInput({
  city,
  value,
  onValueChange,
  onChoose,
  ...props
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [revision, setRevision] = useState(0);
  const [partialCity, setPartialCity] = useState("");
  const [lookup, setLookup] = useState<AddressLookup>();
  const list = useRef<HTMLUListElement>(null);
  const requestId = useRef(0);
  const retryUntil = useRef(0);
  const address = value.trim();
  const searchCity = city.trim();
  const show =
    open && !!searchCity && Array.from(address).length >= 3 && !props.disabled;
  const current =
    show &&
    lookup?.revision === revision &&
    lookup.city === searchCity &&
    lookup.address === address
      ? lookup
      : undefined;
  const options = current?.options ?? [];

  useEffect(() => {
    if (!show) return;
    const controller = new AbortController();
    const id = ++requestId.current;
    const snapshot = { city: searchCity, address, revision };
    const isCurrent = () =>
      !controller.signal.aborted && requestId.current === id;
    const timeout = window.setTimeout(async () => {
      if (!isCurrent()) return;
      if (Date.now() < retryUntil.current) {
        setLookup({ ...snapshot, options: [], message: rateMessage });
        return;
      }
      try {
        const results = await suggestGigPlaces(
          { city: searchCity, address },
          { signal: controller.signal },
        );
        if (!isCurrent()) return;
        setActive(-1);
        setLookup({ ...snapshot, options: results });
      } catch (error) {
        if (!isCurrent()) return;
        const limited = error instanceof ApiError && error.status === 429;
        if (limited)
          retryUntil.current = Date.now() + (error.retryAfter ?? 5) * 1000;
        setLookup({
          ...snapshot,
          options: [],
          message: limited
            ? rateMessage
            : "Подсказки недоступны. Можно ввести адрес вручную.",
        });
      }
    }, delayMs);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [address, revision, searchCity, show]);

  useEffect(() => {
    if (show && active >= 0)
      list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active, show]);

  function close() {
    requestId.current++;
    setOpen(false);
    setActive(-1);
  }

  function choose(suggestion: AddressSuggestion) {
    const complete = suggestion.complete && !!suggestion.point;
    close();
    setPartialCity(complete ? "" : searchCity);
    onChoose(
      suggestion,
      complete ? suggestion.address : suggestion.address + " ",
    );
  }

  return (
    <div
      className="city-input address-input"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <input
        {...props}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={show}
        aria-controls={show ? `${id}-addresses` : undefined}
        aria-activedescendant={
          options[active] ? `${id}-address-${active}` : undefined
        }
        onChange={(event) => {
          requestId.current++;
          setPartialCity("");
          setActive(-1);
          setOpen(event.currentTarget === document.activeElement);
          setRevision((value) => value + 1);
          onValueChange(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && show) {
            event.preventDefault();
            close();
          } else if (
            (event.key === "ArrowDown" || event.key === "ArrowUp") &&
            options.length
          ) {
            event.preventDefault();
            setActive((index) =>
              event.key === "ArrowDown"
                ? (index + 1) % options.length
                : index <= 0
                  ? options.length - 1
                  : index - 1,
            );
          } else if (event.key === "Enter" && options[active]) {
            event.preventDefault();
            choose(options[active]);
          }
        }}
      />
      {show && (
        <div className="city-popup">
          <ul
            id={`${id}-addresses`}
            role="listbox"
            aria-label="Подсказки адреса"
            ref={list}
          >
            {options.map((option, index) => (
              <li
                key={option.label}
                id={`${id}-address-${index}`}
                role="option"
                aria-selected={active === index}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span>{option.address}</span>
                <small>
                  {option.city}
                  {option.region &&
                    option.region !== option.city &&
                    ` · ${option.region}`}
                  {!option.complete && " · Уточните номер дома"}
                </small>
              </li>
            ))}
          </ul>
          {!options.length && (
            <p role="status">
              {!current
                ? "Ищем адреса…"
                : (current.message ??
                  "Адрес не найден. Уточните ввод или заполните адрес вручную.")}
            </p>
          )}
          {options.length > 0 && (
            <p className="city-credit">
              {[...new Set(options.map((option) => option.attribution))].join(
                " · ",
              )}
              {" · "}
              <a
                href="https://www.geoapify.com/"
                target="_blank"
                rel="noreferrer"
              >
                Geoapify
              </a>
            </p>
          )}
        </div>
      )}
      {partialCity && partialCity === searchCity && (
        <p role="status" className="small muted address-help">
          Уточните номер дома.
        </p>
      )}
    </div>
  );
}
