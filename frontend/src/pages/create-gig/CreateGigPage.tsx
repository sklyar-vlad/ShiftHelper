import { formatDateTime } from "@/shared/lib/format";
import { DateTimeField } from "@/shared/ui/DateTimeField";
import {
  localDate,
  apiDate,
  parseLocalDateTime,
  formatDuration,
} from "@/shared/lib/dates";
import { useGigCategories } from "@/entities/gig/GigCategory";
import { CityInput } from "@/shared/ui/CityInput";
import { useSession } from "@/shared/model/session";
import { useUnsavedChanges } from "@/shared/ui/useUnsavedChanges";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import {
  createGig,
  editGigTerms,
  type Gig,
  type GigPoint,
  type CategoryCode,
  getGetGigQueryKey,
  getGetCurrentUserQueryKey,
  type CurrentUser,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";
import { AddressInput } from "./AddressInput";
import { GigPlacePicker } from "./GigPlacePicker";
import "./create-gig.css";

const fields = [
  { name: "title", label: "Название", max: 150, required: true },
  {
    name: "description",
    label: "Описание",
    max: 5000,
    required: true,
    multiline: true,
  },
  { name: "requirements", label: "Требования", max: 2000, multiline: true },
  { name: "city", label: "Город", max: 100, required: true },
  { name: "address", label: "Адрес", max: 300, required: true },
  {
    name: "startsAt",
    label: "Начало работы",
    required: true,
  },
  {
    name: "endsAt",
    label: "Окончание работы",
    required: true,
  },
  { name: "amount", label: "Сумма за всё задание, ₽", required: true, max: 12 },
] as const;
type Name = (typeof fields)[number]["name"];
type Values = Record<Name, string> & {
  category: CategoryCode;
  point: GigPoint;
};

export function parseRubles(value: string): number | null {
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(value.trim())) return null;
  const [rubles, kopecks = ""] = value.trim().split(/[.,]/);
  const amount = Number(rubles) * 100 + Number(kopecks.padEnd(2, "0"));
  return amount >= 1 && amount <= 10000000000 ? amount : null;
}

export function CreateGigPage() {
  const { user } = useSession();
  const { key } = useLocation();
  return <GigForm key={`${user?.id}:${key}`} />;
}

export function GigForm({
  gig,
  onSaved,
  onCancel,
}: {
  gig?: Gig;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const categories = useGigCategories();
  const categoryItems = Array.isArray(categories.data) ? categories.data : [];
  const categoriesReady = categoryItems.length > 0;
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const computedEnd = useRef<{ local: string; iso: string } | null>(null);
  const endApiDate = (value: string) =>
    computedEnd.current?.local === value
      ? computedEnd.current.iso
      : apiDate(value, gig?.endsAt);
  const [duration, setDuration] = useState<number | null>(null);
  const [periodError, setPeriodError] = useState("");
  const [placeRevision, setPlaceRevision] = useState(0);
  const [suggestedPoint, setSuggestedPoint] = useState<GigPoint>(null);
  const {
    register,
    watch,
    control,
    handleSubmit,
    getValues,
    reset,
    setError,
    setValue,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<Values>({
    defaultValues: gig
      ? {
          category: gig.category ?? "other",
          title: gig.title,
          description: gig.description,
          requirements: gig.requirements,
          city: gig.city,
          address: gig.address,
          point: gig.point ?? null,
          startsAt: localDate(gig.startsAt),
          endsAt: localDate(gig.endsAt),
          amount: `${Math.floor(gig.amountKopecks / 100)},${String(gig.amountKopecks % 100).padStart(2, "0")}`,
        }
      : {
          category: "other",
          title: "",
          description: "",
          requirements: "",
          city: "",
          address: "",
          point: null,
          startsAt: "",
          endsAt: "",
          amount: "",
        },
  });
  function placeTextChanged(
    name: "city" | "address",
    value: string,
    suggestion?: GigPoint,
  ) {
    const changed = value.trim() !== getValues(name).trim();
    if (!changed && suggestion === undefined) return;
    if (changed) setValue("point", null, { shouldDirty: true });
    setSuggestedPoint(suggestion ?? null);
    setPlaceRevision((revision) => revision + 1);
  }
  const guard = useUnsavedChanges(isDirty, onCancel);
  const startValue = watch("startsAt") ?? "";
  const endValue = watch("endsAt") ?? "";
  const startISO = apiDate(startValue, gig?.startsAt);
  const endISO = endApiDate(endValue);
  const periodLength =
    startISO && endISO ? Date.parse(endISO) - Date.parse(startISO) : 0;
  function recalculate(value: string, minutes: number) {
    const iso = apiDate(value, gig?.startsAt);
    if (!iso) {
      setPeriodError("Сначала выберите корректные дату и время начала.");
      return false;
    }
    const end = new Date(Date.parse(iso) + minutes * 60000);
    if (end.getUTCFullYear() > 9999) {
      setPeriodError("Окончание выходит за допустимый диапазон дат.");
      return false;
    }
    computedEnd.current = {
      local: localDate(end.toISOString()),
      iso: end.toISOString(),
    };
    setValue("endsAt", computedEnd.current.local, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setPeriodError("");
    return true;
  }
  function chooseDuration(minutes: number | null) {
    if (minutes === null) {
      setDuration(null);
      setPeriodError("");
      return;
    }
    if (recalculate(getValues("startsAt"), minutes)) setDuration(minutes);
  }
  const submit = handleSubmit(async (values) => {
    if (busy.current || !categoriesReady) return;
    busy.current = true;
    setWorking(true);
    setMessage("");
    const userId = client.getQueryData<CurrentUser>(
      getGetCurrentUserQueryKey(),
    )?.id;
    try {
      const { amount, point, ...input } = values;
      const payload = {
        ...input,
        title: input.title.trim(),
        description: input.description.trim(),
        requirements: input.requirements.trim(),
        city: input.city.trim(),
        address: input.address.trim(),
        startsAt: apiDate(input.startsAt, gig?.startsAt)!,
        endsAt: endApiDate(input.endsAt)!,
        amountKopecks: parseRubles(amount)!,
      };
      const result = gig
        ? await editGigTerms(gig.id, {
            ...payload,
            ...(dirtyFields.point ? { point } : {}),
            termsVersion: gig.termsVersion ?? 1,
          })
        : await createGig({ ...payload, ...(point ? { point } : {}) });
      if (
        client.getQueryData<CurrentUser>(getGetCurrentUserQueryKey())?.id !==
        userId
      )
        return;
      if (!guard.allowSavedExit()) return;
      reset(values);
      if (gig) {
        await client.invalidateQueries();
        onSaved?.();
        return;
      }
      client.setQueryData(getGetGigQueryKey(result.id), result);
      void client.invalidateQueries({ queryKey: ["/api/v1/gigs"] });
      navigate(`/gigs/${result.id}`, { replace: true });
    } catch (error) {
      const serverFields =
        error instanceof ApiError ? error.details?.fields : undefined;
      let matched = false;
      if (serverFields?.category?.[0]) {
        setError(
          "category",
          { message: serverFields.category[0] },
          { shouldFocus: true },
        );
        matched = true;
      }
      for (const { name } of fields) {
        const text =
          serverFields?.[name === "amount" ? "amountKopecks" : name]?.[0];
        if (text) {
          setError(name, { message: text }, { shouldFocus: !matched });
          matched = true;
        }
      }
      if (error instanceof ApiError && [403, 404, 409].includes(error.status))
        await client.invalidateQueries();
      if (!matched)
        setMessage(
          error instanceof ApiError
            ? error.message
            : "Не удалось связаться с сервисом. Попробуйте ещё раз.",
        );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  });

  return (
    <section className="create-gig">
      <header className="page-heading">
        <h1 id="create-gig-title">
          {gig ? "Изменение условий" : "Новое задание"}
        </h1>
        <p className="muted">
          {gig
            ? gig.status === "in_progress"
              ? "Действующие условия сохранятся до согласия исполнителя."
              : "Кандидаты с откликами должны подтвердить новую редакцию перед выбором."
            : "Опишите работу и укажите общую оплату. Расчёт — напрямую с исполнителем."}
        </p>
      </header>
      <form onSubmit={submit} noValidate aria-labelledby="create-gig-title">
        <fieldset className="form-fields" disabled={working}>
          <div className="form-field category-field">
            <label htmlFor="gig-category">Категория</label>
            <select
              id="gig-category"
              value={watch("category")}
              disabled={!categoriesReady}
              aria-invalid={!!errors.category}
              aria-describedby="gig-category-status gig-category-error"
              {...register("category", {
                validate: (value) =>
                  categoryItems.some((item) => item.code === value) ||
                  "Выберите категорию из справочника.",
              })}
            >
              {!categoriesReady && (
                <option value={watch("category")}>
                  {categories.isPending
                    ? "Загружаем категории…"
                    : "Категории недоступны"}
                </option>
              )}
              {categoriesReady &&
                !categoryItems.some(
                  (item) => item.code === watch("category"),
                ) && (
                  <option value={watch("category")} disabled>
                    Выберите доступную категорию
                  </option>
                )}
              {categoryItems.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
            <p id="gig-category-status" className="small muted" role="status">
              {categories.isPending
                ? "Загружаем справочник категорий…"
                : !categoriesReady
                  ? "Не удалось загрузить категории. Остальной ввод сохранён."
                  : "Выберите направление работы — так исполнителям проще понять задачу."}
            </p>
            {!categories.isPending && !categoriesReady && (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void categories.refetch()}
              >
                Загрузить категории снова
              </button>
            )}
            <p id="gig-category-error" className="field-error">
              {errors.category?.message}
            </p>
          </div>
          {fields.map((field) => {
            const max = "max" in field ? field.max : undefined;
            const rules = {
              validate: (value: string) => {
                if ("required" in field && field.required && !value.trim())
                  return "Заполните поле.";
                if (max && Array.from(value.trim()).length > max)
                  return `Не больше ${max} символов.`;
                if (field.name === "amount" && parseRubles(value) === null)
                  return "Укажите от 0,01 до 100 000 000 ₽, не больше двух знаков после запятой.";
                if (
                  (field.name === "startsAt" || field.name === "endsAt") &&
                  !parseLocalDateTime(value)
                )
                  return "Укажите корректные дату и время в вашем часовом поясе.";
                if (
                  field.name === "startsAt" &&
                  !(new Date(value).getTime() > Date.now()) &&
                  !(gig && value === localDate(gig.startsAt))
                )
                  return "Начало должно быть в будущем.";
                if (
                  field.name === "endsAt" &&
                  !(
                    Date.parse(endApiDate(value) ?? "") >
                    Date.parse(
                      apiDate(getValues("startsAt"), gig?.startsAt) ?? "",
                    )
                  )
                )
                  return "Окончание должно быть позже начала.";
                return true;
              },
            };
            const props = {
              id: field.name,
              maxLength: max,
              "aria-invalid": !!errors[field.name],
              "aria-describedby": errors[field.name]
                ? `${field.name}-error`
                : undefined,
              ...register(field.name, rules),
            };
            return (
              <div className="form-field" key={field.name}>
                {field.name !== "startsAt" && field.name !== "endsAt" && (
                  <label htmlFor={field.name}>
                    {field.label}
                    {field.name === "requirements" && " (необязательно)"}
                  </label>
                )}
                {field.name === "startsAt" || field.name === "endsAt" ? (
                  <Controller
                    name={field.name}
                    control={control}
                    defaultValue=""
                    rules={rules}
                    render={({ field: binding }) => (
                      <DateTimeField
                        id={field.name}
                        label={field.label}
                        value={binding.value}
                        initialValue={gig ? localDate(gig[field.name]) : ""}
                        onChange={(next) => {
                          binding.onChange(next);
                          if (field.name === "endsAt") {
                            computedEnd.current = null;
                            setDuration(null);
                            setPeriodError("");
                          } else if (duration) recalculate(next, duration);
                        }}
                        onBlur={binding.onBlur}
                        inputRef={binding.ref}
                        error={errors[field.name]?.message}
                        disabled={working}
                      />
                    )}
                  />
                ) : field.name === "city" ? (
                  <Controller
                    name="city"
                    control={control}
                    defaultValue=""
                    rules={{
                      validate: (value) =>
                        (!!value.trim() &&
                          Array.from(value.trim()).length <= 100) ||
                        "Укажите город до 100 символов.",
                    }}
                    render={({ field: binding }) => (
                      <CityInput
                        id="city"
                        name={binding.name}
                        value={binding.value}
                        ref={binding.ref}
                        onBlur={binding.onBlur}
                        onValueChange={(value) => {
                          placeTextChanged("city", value);
                          binding.onChange(value);
                        }}
                        maxLength={100}
                        aria-invalid={!!errors.city}
                        aria-describedby={
                          errors.city ? "city-error" : undefined
                        }
                      />
                    )}
                  />
                ) : field.name === "address" ? (
                  <Controller
                    name="address"
                    control={control}
                    rules={rules}
                    render={({ field: binding }) => (
                      <AddressInput
                        id="address"
                        name={binding.name}
                        value={binding.value}
                        ref={binding.ref}
                        onBlur={binding.onBlur}
                        city={watch("city")}
                        maxLength={300}
                        disabled={working}
                        aria-invalid={!!errors.address}
                        aria-describedby={
                          errors.address ? "address-error" : undefined
                        }
                        onValueChange={(value) => {
                          placeTextChanged("address", value);
                          binding.onChange(value);
                        }}
                        onChoose={(suggestion, value) => {
                          placeTextChanged(
                            "address",
                            value,
                            suggestion.complete
                              ? (suggestion.point ?? null)
                              : null,
                          );
                          binding.onChange(value);
                        }}
                      />
                    )}
                  />
                ) : "multiline" in field ? (
                  <textarea
                    {...props}
                    rows={field.name === "description" ? 5 : 3}
                  />
                ) : (
                  <input
                    {...props}
                    type="text"
                    inputMode={field.name === "amount" ? "decimal" : undefined}
                  />
                )}
                {field.name === "endsAt" && (
                  <>
                    <div
                      className="duration-presets"
                      role="group"
                      aria-label="Быстрая длительность"
                    >
                      {[120, 240, 480].map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          className="duration-preset"
                          aria-pressed={duration === minutes}
                          onClick={() => chooseDuration(minutes)}
                        >
                          На {minutes / 60} {minutes === 480 ? "часов" : "часа"}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="duration-preset"
                        aria-pressed={duration === null}
                        onClick={() => chooseDuration(null)}
                      >
                        Свой период
                      </button>
                    </div>
                    {periodError && (
                      <p className="field-error" role="alert">
                        {periodError}
                      </p>
                    )}
                    {periodLength > 0 && startISO && endISO && (
                      <p className="period-summary" role="status">
                        {formatDateTime(startISO)} — {formatDateTime(endISO)}.
                        Длительность: {formatDuration(periodLength)}.
                      </p>
                    )}
                  </>
                )}
                {field.name !== "startsAt" &&
                  field.name !== "endsAt" &&
                  errors[field.name] && (
                    <p id={`${field.name}-error`} className="field-error">
                      {errors[field.name]?.message}
                    </p>
                  )}
                {field.name === "address" && (
                  <GigPlacePicker
                    key={placeRevision}
                    city={watch("city")}
                    address={watch("address")}
                    point={watch("point")}
                    suggestedPoint={suggestedPoint}
                    onChange={(point) =>
                      setValue("point", point, { shouldDirty: true })
                    }
                  />
                )}
              </div>
            );
          })}
          <p className="small muted">
            Сумма указана за всё задание. Даты вводятся в вашем часовом поясе.
          </p>
          {message && (
            <p role="alert" className="notice notice-error">
              {message}
            </p>
          )}
          <button
            className="button"
            disabled={working || !categoriesReady}
            type="submit"
          >
            {working
              ? gig
                ? "Сохраняем…"
                : "Публикуем…"
              : gig
                ? gig.status === "in_progress"
                  ? "Предложить изменения"
                  : "Сохранить условия"
                : "Опубликовать"}
          </button>
          {onCancel && (
            <button
              type="button"
              className="button button-secondary"
              onClick={guard.requestClose}
            >
              Отмена
            </button>
          )}
        </fieldset>
      </form>
      {guard.dialog}
    </section>
  );
}
