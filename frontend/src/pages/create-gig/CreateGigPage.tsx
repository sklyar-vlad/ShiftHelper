import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  createGig,
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
type Values = Record<Name, string>;

export function parseRubles(value: string): number | null {
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(value.trim())) return null;
  const [rubles, kopecks = ""] = value.trim().split(/[.,]/);
  const amount = Number(rubles) * 100 + Number(kopecks.padEnd(2, "0"));
  return amount >= 1 && amount <= 10000000000 ? amount : null;
}

export function CreateGigPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    formState: { errors },
  } = useForm<Values>();
  const submit = handleSubmit(async (values) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setMessage("");
    const userId = client.getQueryData<CurrentUser>(
      getGetCurrentUserQueryKey(),
    )?.id;
    try {
      const { amount, ...input } = values;
      const gig = await createGig({
        ...input,
        title: input.title.trim(),
        description: input.description.trim(),
        requirements: input.requirements.trim(),
        city: input.city.trim(),
        address: input.address.trim(),
        startsAt: new Date(input.startsAt).toISOString(),
        endsAt: new Date(input.endsAt).toISOString(),
        amountKopecks: parseRubles(amount)!,
      });
      if (
        client.getQueryData<CurrentUser>(getGetCurrentUserQueryKey())?.id !==
        userId
      )
        return;
      client.setQueryData(getGetGigQueryKey(gig.id), gig);
      void client.invalidateQueries({ queryKey: ["/api/v1/gigs"] });
      navigate(`/gigs/${gig.id}`, { replace: true });
    } catch (error) {
      const serverFields =
        error instanceof ApiError ? error.details?.fields : undefined;
      let matched = false;
      for (const { name } of fields) {
        const text =
          serverFields?.[name === "amount" ? "amountKopecks" : name]?.[0];
        if (text) {
          setError(name, { message: text }, { shouldFocus: !matched });
          matched = true;
        }
      }
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
        <h1 id="create-gig-title">Новое задание</h1>
        <p className="muted">
          Опишите работу и укажите общую оплату. Расчёт — напрямую с
          исполнителем.
        </p>
      </header>
      <form onSubmit={submit} noValidate aria-labelledby="create-gig-title">
        <fieldset className="form-fields" disabled={working}>
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
                    !(new Date(value).getTime() > Date.now())
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
                {"multiline" in field ? (
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
          <button className="button" disabled={working} type="submit">
            {working ? "Публикуем…" : "Опубликовать"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
