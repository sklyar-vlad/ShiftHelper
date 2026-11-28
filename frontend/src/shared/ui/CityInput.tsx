import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { loadCities, searchCities, type City } from "@/shared/lib/cities";
import "./city-input.css";

type Props = Omit<
  ComponentProps<"input">,
  "value" | "defaultValue" | "onChange"
> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

export function CityInput({
  value,
  defaultValue = "",
  onValueChange,
  ...props
}: Props) {
  const uid = useId();
  const [input, setInput] = useState(defaultValue);
  const [cities, setCities] = useState<City[]>([]);
  const [state, setState] = useState("loading");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const list = useRef<HTMLUListElement>(null);
  const text = value ?? input;
  const options = searchCities(cities, text);
  const show = open && text.trim().length >= 2;
  useEffect(() => {
    let mounted = true;
    loadCities()
      .then((data) => {
        if (mounted) {
          setCities(data);
          setState("ready");
        }
      })
      .catch(() => {
        if (mounted) setState("error");
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (show && active >= 0)
      list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active, show]);
  const change = (next: string) => {
    setInput(next);
    onValueChange?.(next);
    setActive(-1);
  };
  const choose = (city: City) => {
    change(city.value);
    setOpen(false);
  };
  return (
    <div className="city-input">
      <input
        {...props}
        value={text}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={show}
        aria-controls={`${uid}-list`}
        aria-activedescendant={
          show && active >= 0 ? `${uid}-${active}` : undefined
        }
        onChange={(event) => {
          change(event.target.value);
          setOpen(true);
        }}
        onFocus={(event) => {
          setOpen(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setOpen(false);
          setActive(-1);
          props.onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setActive(-1);
          } else if (event.key === "Tab") {
            setOpen(false);
            setActive(-1);
          } else if (
            (event.key === "ArrowDown" || event.key === "ArrowUp") &&
            options.length
          ) {
            event.preventDefault();
            setOpen(true);
            setActive((current) =>
              event.key === "ArrowDown"
                ? (current + 1) % options.length
                : current <= 0
                  ? options.length - 1
                  : current - 1,
            );
          } else if (
            event.key === "Enter" &&
            show &&
            active >= 0 &&
            options[active]
          ) {
            event.preventDefault();
            choose(options[active]);
          }
          props.onKeyDown?.(event);
        }}
      />
      {show && (
        <div className="city-popup">
          <ul id={`${uid}-list`} role="listbox" aria-label="Города" ref={list}>
            {options.map((city, index) => (
              <li
                key={city.value}
                id={`${uid}-${index}`}
                role="option"
                aria-selected={active === index}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(city)}
              >
                <span>{city.name}</span>
                <small>{city.region}</small>
              </li>
            ))}
          </ul>
          {!options.length && (
            <p role="status">
              {state === "loading"
                ? "Загружаем города…"
                : state === "error"
                  ? "Подсказки недоступны. Введите город вручную."
                  : "Ничего не найдено. Можно ввести свой город."}
            </p>
          )}
          <p
            className="city-credit"
            onPointerDown={(event) => event.preventDefault()}
          >
            Данные{" "}
            <a
              href="https://github.com/hflabs/city"
              target="_blank"
              rel="noreferrer"
            >
              DaData / HFLabs
            </a>{" "}
            ·{" "}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-SA 4.0
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
