import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import {
  login,
  register as registerAccount,
  type Role,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";
import { useSession } from "@/shared/model/session";
import { StatusPanel } from "@/shared/ui/StatusPanel";
import "./auth.css";

type Fields = { name: string; email: string; password: string; role: Role };

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const creating = mode === "register";
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { from?: unknown; expired?: boolean } | null;
  const target =
    typeof state?.from === "string" &&
    state.from.startsWith("/") &&
    !state.from.startsWith("//") &&
    !/^\/(login|register)([/?#]|$)/.test(state.from)
      ? state.from
      : "/profile";
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const {
    register,
    handleSubmit,
    setError,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<Fields>({
    defaultValues: { role: "worker" },
    shouldUnregister: true,
  });

  const submit = handleSubmit(async (values) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setMessage("");
    try {
      const credentials = {
        email: values.email.trim(),
        password: values.password,
      };
      const user = creating
        ? await registerAccount({
            ...credentials,
            name: values.name.trim(),
            role: values.role,
          })
        : await login(credentials);
      await session.signIn(user);
      navigate(target, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.details?.code === "EMAIL_TAKEN") {
        setError(
          "email",
          { message: "Этот email уже зарегистрирован. Попробуйте войти." },
          { shouldFocus: true },
        );
      } else if (error instanceof ApiError && error.details?.fields) {
        const names = (["name", "email", "password", "role"] as const).filter(
          (name) => error.details?.fields?.[name]?.length,
        );
        if (!names.length) setMessage(error.message);
        names.forEach((name, index) =>
          setError(
            name,
            { message: error.details!.fields![name][0] },
            { shouldFocus: index === 0 },
          ),
        );
      } else {
        setMessage(
          error instanceof ApiError
            ? error.message
            : "Не удалось связаться с сервисом. Проверьте соединение и попробуйте ещё раз.",
        );
      }
    } finally {
      values.password = "";
      resetField("password", { keepError: true });
      setVisible(false);
      busy.current = false;
      setWorking(false);
    }
  });

  if (session.isPending)
    return <StatusPanel title="Проверяем аккаунт" pending />;
  if (session.user && !session.isError) return <Navigate to={target} replace />;

  return (
    <div className="auth-layout">
      <aside className="auth-intro">
        <p className="eyebrow">Каждому делу — свой человек</p>
        <div>
          <span className="auth-star" aria-hidden="true">
            ✳
          </span>
          <h2>
            {creating ? (
              <>
                Большие возможности.
                <br />
                Простой первый шаг.
              </>
            ) : (
              <>
                С возвращением.
                <br />
                Ваш ритм работы ждёт.
              </>
            )}
          </h2>
          <p>
            Находите подработку или помощь для своих задач. В удобное время, на
            понятных условиях.
          </p>
        </div>
        <span className="auth-intro-footer">
          Ваш график. Ваш выбор. Ваш ShiftHelper.
        </span>
      </aside>
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="eyebrow">
          {creating ? "Давайте познакомимся" : "Рады видеть вас снова"}
        </p>
        <h1 id="auth-title">
          {creating ? "Создать аккаунт" : "Войти в аккаунт"}
        </h1>
        <p className="auth-switch">
          {creating ? "Уже с нами? " : "Ещё нет аккаунта? "}
          <Link to={creating ? "/login" : "/register"} state={location.state}>
            {creating ? "Войти" : "Зарегистрироваться"}
          </Link>
        </p>
        {state?.expired && !session.expired && (
          <p className="notice">Войдите, чтобы продолжить.</p>
        )}
        <form onSubmit={submit} noValidate aria-labelledby="auth-title">
          <fieldset className="form-fields" disabled={isSubmitting || working}>
            {creating && (
              <>
                <fieldset className="role-picker">
                  <legend>Для чего вам ShiftHelper?</legend>
                  <div className="role-options">
                    <label className="role-option">
                      <input
                        type="radio"
                        value="worker"
                        {...register("role", { required: "Выберите роль." })}
                      />
                      <span>
                        <strong>Ищу подработку</strong>
                        <small>Я исполнитель</small>
                      </span>
                    </label>
                    <label className="role-option">
                      <input
                        type="radio"
                        value="customer"
                        {...register("role", { required: "Выберите роль." })}
                      />
                      <span>
                        <strong>Нужна помощь</strong>
                        <small>Я заказчик</small>
                      </span>
                    </label>
                  </div>
                  <p className="field-hint">Роль выбирается при регистрации.</p>
                  {errors.role && (
                    <p className="field-error">{errors.role.message}</p>
                  )}
                </fieldset>
                <div className="form-field">
                  <label htmlFor="name">Ваше имя</label>
                  <input
                    id="name"
                    autoComplete="name"
                    placeholder="Как к вам обращаться?"
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? "name-error" : undefined}
                    {...register("name", {
                      required: "Укажите имя.",
                      validate: (value) =>
                        value.trim().length > 0 || "Укажите имя.",
                      maxLength: {
                        value: 100,
                        message: "Не больше 100 символов.",
                      },
                    })}
                  />
                  {errors.name && (
                    <p id="name-error" className="field-error">
                      {errors.name.message}
                    </p>
                  )}
                </div>
              </>
            )}
            <div className="form-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "email-error" : undefined}
                {...register("email", {
                  required: "Укажите email.",
                  validate: (value) =>
                    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ||
                    "Укажите корректный email.",
                  maxLength: { value: 254, message: "Слишком длинный email." },
                })}
              />
              {errors.email && (
                <p id="email-error" className="field-error">
                  {errors.email.message}
                </p>
              )}
            </div>
            <div className="form-field">
              <label htmlFor="password">Пароль</label>
              <div className="password-input">
                <input
                  id="password"
                  type={visible ? "text" : "password"}
                  autoComplete={creating ? "new-password" : "current-password"}
                  placeholder={
                    creating ? "От 8 до 128 символов" : "Введите пароль"
                  }
                  aria-invalid={!!errors.password}
                  aria-describedby={
                    errors.password
                      ? "password-error"
                      : creating
                        ? "password-hint"
                        : undefined
                  }
                  {...register("password", {
                    required: "Введите пароль.",
                    validate: (value) =>
                      (Array.from(value).length >= 8 &&
                        Array.from(value).length <= 128) ||
                      "Пароль должен содержать от 8 до 128 символов.",
                  })}
                />
                <button
                  type="button"
                  aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? "Скрыть" : "Показать"}
                </button>
              </div>
              {errors.password ? (
                <p id="password-error" className="field-error">
                  {errors.password.message}
                </p>
              ) : (
                creating && (
                  <p id="password-hint" className="field-hint">
                    Не меньше 8 символов. Пробелы в пароле учитываются.
                  </p>
                )
              )}
            </div>
            {message && (
              <p className="notice notice-error" role="alert">
                {message}
              </p>
            )}
            <button
              className="button auth-submit"
              type="submit"
              disabled={isSubmitting || working}
            >
              {isSubmitting || working
                ? creating
                  ? "Создаём аккаунт…"
                  : "Входим…"
                : creating
                  ? "Создать аккаунт"
                  : "Войти"}
              <span aria-hidden="true">↗</span>
            </button>
          </fieldset>
        </form>
        <p className="auth-footnote">
          {creating
            ? "Один аккаунт — одна роль. Оплата за работу — напрямую между участниками."
            : "Войдите, чтобы вернуться к своему профилю и заданиям."}
        </p>
      </section>
    </div>
  );
}
