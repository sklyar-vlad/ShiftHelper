import { useState } from "react";
import { Link } from "react-router";
import { CityInput } from "@/shared/ui/CityInput";
import type { GigCategory } from "@/shared/api/generated/api";
import {
  catalogQuery,
  sortLabels,
  durationLabels,
  type Filters,
  type FilterErrors,
} from "./filters";

export function CatalogFilters({
  initial,
  categories,
  loading,
  retry,
  onApply,
}: {
  initial: Filters;
  categories?: GigCategory[];
  loading: boolean;
  retry: () => void;
  onApply: (filters: Filters) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<FilterErrors>({});
  const [expanded, setExpanded] = useState(false);
  const change = (key: keyof Filters, value: string) =>
    setDraft({ ...draft, [key]: value });
  const error = (key: keyof Filters) =>
    errors[key] && (
      <span id={`filter-${key}-error`} className="field-error" role="alert">
        {errors[key]}
      </span>
    );
  const input = (key: keyof Filters, label: string, type = "text") => (
    <div>
      <label htmlFor={`filter-${key}`}>{label}</label>
      <input
        id={`filter-${key}`}
        name={key}
        type={type}
        inputMode={key.endsWith("Pay") ? "decimal" : undefined}
        value={draft[key]}
        onChange={(event) => change(key, event.target.value)}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `filter-${key}-error` : undefined}
      />
      {error(key)}
    </div>
  );
  const select = (
    key: "duration" | "sort",
    label: string,
    options: Record<string, string>,
  ) => (
    <div>
      <label htmlFor={`filter-${key}`}>{label}</label>
      <select
        id={`filter-${key}`}
        name={key}
        value={draft[key]}
        onChange={(event) => change(key, event.target.value)}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `filter-${key}-error` : undefined}
      >
        {!Object.hasOwn(options, draft[key]) && (
          <option value={draft[key]}>Выберите значение</option>
        )}
        {Object.entries(options)
          .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0))
          .map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
      </select>
      {error(key)}
    </div>
  );
  return (
    <form
      className="catalog-filters"
      aria-label="Поиск подработок"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const result = catalogQuery(
          draft,
          1,
          categories?.map((item) => item.code),
        );
        setErrors(result.errors);
        if (result.valid) onApply(draft);
        else setExpanded(true);
      }}
    >
      <div className="catalog-search-row">
        <label>
          Название задания
          <input
            name="q"
            maxLength={150}
            placeholder="Например, помощь с переездом"
            value={draft.q}
            onChange={(event) => change("q", event.target.value)}
            aria-invalid={!!errors.q}
            aria-describedby={errors.q ? "filter-q-error" : undefined}
          />
          {error("q")}
        </label>
        <div className="catalog-city">
          <label htmlFor="catalog-city">Город</label>
          <CityInput
            id="catalog-city"
            name="city"
            value={draft.city}
            onValueChange={(value) => change("city", value)}
            maxLength={100}
            placeholder="Например, Москва"
            aria-invalid={!!errors.city}
            aria-describedby={errors.city ? "filter-city-error" : undefined}
          />
          {error("city")}
        </div>
        <button className="button" type="submit">
          Найти
        </button>
      </div>
      <button
        type="button"
        className="button button-secondary catalog-filter-toggle"
        aria-expanded={expanded}
        aria-controls="catalog-options"
        onClick={() => setExpanded(!expanded)}
      >
        Фильтры {expanded ? "−" : "+"}
      </button>
      <div
        id="catalog-options"
        className="catalog-filter-options"
        data-expanded={expanded}
      >
        <div>
          <label htmlFor="filter-category">Категория</label>
          <select
            id="filter-category"
            name="category"
            value={draft.category}
            disabled={!categories}
            onChange={(event) => change("category", event.target.value)}
            aria-invalid={!!errors.category}
            aria-describedby={
              errors.category ? "filter-category-error" : undefined
            }
          >
            <option value="">Все категории</option>
            {draft.category &&
              !categories?.some((item) => item.code === draft.category) && (
                <option value={draft.category}>{draft.category}</option>
              )}
            {categories?.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
          {error("category")}
        </div>
        {select("sort", "Сортировка", sortLabels)}
        {input("minPay", "Оплата от, ₽")}
        {input("maxPay", "Оплата до, ₽")}
        {input("dateFrom", "Начало от", "date")}
        {input("dateTo", "Начало до, включительно", "date")}
        {select("duration", "Длительность", { "": "Любая", ...durationLabels })}
        <p className="small muted catalog-filter-help">
          Общая оплата за задание. Даты — в вашем часовом поясе. Новые значения
          применяются по кнопке «Найти».
        </p>
        <button className="button catalog-filter-apply" type="submit">
          Применить
        </button>
      </div>
      {!categories && (
        <p className="small muted">
          {loading ? (
            "Загружаем категории…"
          ) : (
            <>
              Не удалось загрузить категории.{" "}
              <button className="text-link" type="button" onClick={retry}>
                Повторить загрузку
              </button>
              {draft.category && (
                <>
                  {" "}
                  <Link to="/catalog">Сбросить фильтры</Link>
                </>
              )}
            </>
          )}
        </p>
      )}
    </form>
  );
}
