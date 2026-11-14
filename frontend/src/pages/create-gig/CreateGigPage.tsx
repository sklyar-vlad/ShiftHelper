import { useGigCategories } from "@/entities/gig/GigCategory";
import { CityInput } from "@/shared/ui/CityInput";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  createGig,
  editGigTerms,
  type Gig,
  type CategoryCode,
  getGetGigQueryKey,
  getGetCurrentUserQueryKey,
  type CurrentUser,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";
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
    type: "datetime-local",
  },
  {
    name: "endsAt",
    label: "Окончание работы",
    required: true,
    type: "datetime-local",
  },
  { name: "amount", label: "Сумма за всё задание, ₽", required: true, max: 12 },
] as const;
type Name = (typeof fields)[number]["name"];
type Values = Record<Name, string> & { category: CategoryCode };

export function parseRubles(value: string): number | null {
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(value.trim())) return null;
  const [rubles, kopecks = ""] = value.trim().split(/[.,]/);
  const amount = Number(rubles) * 100 + Number(kopecks.padEnd(2, "0"));
  return amount >= 1 && amount <= 10000000000 ? amount : null;
}

export function CreateGigPage() {
  return <GigForm />;
}

function localDate(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, -1);
}
function apiDate(value: string, original?: string) {
  return original && new Date(value).getTime() === new Date(original).getTime()
    ? original
    : new Date(value).toISOString();
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
  const {
    register,
    watch,
    control,
    handleSubmit,
    getValues,
    setError,
    formState: { errors },
  } = useForm<Values>({
    defaultValues: gig
      ? {
          category: gig.category ?? "other",
          title: gig.title,
          description: gig.description,
          requirements: gig.requirements,
          city: gig.city,
          address: gig.address,
          startsAt: localDate(gig.startsAt),
          endsAt: localDate(gig.endsAt),
          amount: `${Math.floor(gig.amountKopecks / 100)},${String(gig.amountKopecks % 100).padStart(2, "0")}`,
        }
      : { category: "other" },
  });
  const submit = handleSubmit(async (values) => {
    if (busy.current || !categoriesReady) return;
    busy.current = true;
    setWorking(true);
    setMessage("");
    const userId = client.getQueryData<CurrentUser>(
      getGetCurrentUserQueryKey(),
    )?.id;
    try {
      const { amount, ...input } = values;
      const payload = {
        ...input,
        title: input.title.trim(),
        description: input.description.trim(),
        requirements: input.requirements.trim(),
        city: input.city.trim(),
        address: input.address.trim(),
        startsAt: apiDate(input.startsAt, gig?.startsAt),
        endsAt: apiDate(input.endsAt, gig?.endsAt),
        amountKopecks: parseRubles(amount)!,
      };
      const result = gig
        ? await editGigTerms(gig.id, {
            ...payload,
            termsVersion: gig.termsVersion ?? 1,
          })
        : await createGig(payload);
      if (
        client.getQueryData<CurrentUser>(getGetCurrentUserQueryKey())?.id !==
        userId
      )
        return;
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
            const props = {
              id: field.name,
              maxLength: max,
              "aria-invalid": !!errors[field.name],
              "aria-describedby": errors[field.name]
                ? `${field.name}-error`
                : undefined,
              ...register(field.name, {
                validate: (value) => {
                  if ("required" in field && field.required && !value.trim())
                    return "Заполните поле.";
                  if (max && Array.from(value.trim()).length > max)
                    return `Не больше ${max} символов.`;
                  if (field.name === "amount" && parseRubles(value) === null)
                    return "Укажите от 0,01 до 100 000 000 ₽, не больше двух знаков после запятой.";
                  if (
                    field.name === "startsAt" &&
                    !(new Date(value).getTime() > Date.now()) &&
                    !(
                      gig &&
                      new Date(value).getTime() ===
                        new Date(gig.startsAt).getTime()
                    )
                  )
                    return "Начало должно быть в будущем.";
                  if (
                    field.name === "endsAt" &&
                    !(
                      new Date(value).getTime() >
                      new Date(getValues("startsAt")).getTime()
                    )
                  )
                    return "Окончание должно быть позже начала.";
                  return true;
                },
              }),
            };
            return (
              <div className="form-field" key={field.name}>
                <label htmlFor={field.name}>
                  {field.label}
                  {field.name === "requirements" && " (необязательно)"}
                </label>
                {field.name === "city" ? (
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
                        onValueChange={binding.onChange}
                        maxLength={100}
                        aria-invalid={!!errors.city}
                        aria-describedby={
                          errors.city ? "city-error" : undefined
                        }
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
                    type={"type" in field ? field.type : "text"}
                    inputMode={field.name === "amount" ? "decimal" : undefined}
                  />
                )}
                {errors[field.name] && (
                  <p id={`${field.name}-error`} className="field-error">
                    {errors[field.name]?.message}
                  </p>
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
              onClick={onCancel}
            >
              Отмена
            </button>
          )}
        </fieldset>
      </form>
    </section>
  );
}
