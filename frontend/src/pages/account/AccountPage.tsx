import { roleNames, useSession } from "@/shared/model/session";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCurrentUserQueryKey,
  updateProfile,
  type CurrentUser,
  type UpdateProfileRequest,
} from "@/shared/api/generated/api";
import { ApiError } from "@/shared/api/http";

export function AccountPage() {
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!user) return null;
  return (
    <div className="account-page">
      <div className="page-heading">
        <p className="eyebrow">Ваше пространство</p>
        <h1>Мой профиль</h1>
        <p className="muted">Рады видеть вас в ShiftHelper.</p>
      </div>
      <section className="profile-card">
        <div className="profile-heading">
          <span className="avatar avatar-large" aria-hidden="true">
            {Array.from(user.name)[0]}
          </span>
          <div>
            <span className="badge">{roleNames[user.role]}</span>
            <h2>{user.name}</h2>
          </div>
        </div>
        <dl className="profile-details">
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Завершено заданий</dt>
            <dd>{user.completedGigsCount}</dd>
          </div>
          <div>
            <dt>О себе</dt>
            <dd>{user.bio || "Описание пока не добавлено"}</dd>
          </div>
        </dl>
        {editing ? (
          <ProfileForm
            user={user}
            onClose={(success) => {
              setEditing(false);
              setSaved(success);
            }}
          />
        ) : (
          <button
            className="button button-secondary profile-edit"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            Редактировать профиль
          </button>
        )}
        {saved && (
          <p className="notice" role="status">
            Профиль сохранён.
          </p>
        )}
      </section>
    </div>
  );
}

function ProfileForm({
  user,
  onClose,
}: {
  user: CurrentUser;
  onClose: (saved: boolean) => void;
}) {
  const client = useQueryClient();
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<UpdateProfileRequest>({
    defaultValues: { name: user.name, bio: user.bio },
  });
  const submit = handleSubmit(async (values) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setMessage("");
    try {
      const updated = await updateProfile({
        name: values.name.trim(),
        bio: values.bio.trim(),
      });
      const key = getGetCurrentUserQueryKey();
      await client.cancelQueries({ queryKey: key });
      if (client.getQueryData<CurrentUser | null>(key)?.id !== user.id) return;
      client.setQueryData(key, updated);
      void client.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== key[0],
      });
      onClose(true);
    } catch (error) {
      let matched = false;
      for (const name of ["name", "bio"] as const) {
        const text =
          error instanceof ApiError
            ? error.details?.fields?.[name]?.[0]
            : undefined;
        if (text) {
          setError(name, { message: text }, { shouldFocus: !matched });
          matched = true;
        }
      }
      if (!matched)
        setMessage(
          error instanceof ApiError
            ? error.message
            : "Не удалось сохранить профиль. Попробуйте ещё раз.",
        );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  });
  return (
    <form
      className="profile-edit"
      aria-label="Редактирование профиля"
      onSubmit={submit}
      noValidate
    >
      <fieldset className="form-fields" disabled={working}>
        <div className="form-field">
          <label htmlFor="profile-name">Имя</label>
          <input
            id="profile-name"
            maxLength={100}
            autoComplete="name"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "profile-name-error" : undefined}
            {...register("name", {
              validate: (value) =>
                (value.trim().length > 0 &&
                  Array.from(value.trim()).length <= 100) ||
                "Укажите имя от 1 до 100 символов.",
            })}
          />
          {errors.name && (
            <p className="field-error" id="profile-name-error">
              {errors.name.message}
            </p>
          )}
        </div>
        <div className="form-field">
          <label htmlFor="profile-bio">О себе</label>
          <textarea
            id="profile-bio"
            rows={4}
            maxLength={1000}
            aria-invalid={!!errors.bio}
            aria-describedby={errors.bio ? "profile-bio-error" : undefined}
            {...register("bio", {
              validate: (value) =>
                Array.from(value.trim()).length <= 1000 ||
                "Не больше 1000 символов.",
            })}
          />
          {errors.bio && (
            <p className="field-error" id="profile-bio-error">
              {errors.bio.message}
            </p>
          )}
        </div>
        {message && (
          <p className="notice notice-error" role="alert">
            {message}
          </p>
        )}
        <div className="profile-actions">
          <button className="button" type="submit" disabled={working}>
            {working ? "Сохраняем…" : "Сохранить"}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => onClose(false)}
          >
            Отмена
          </button>
        </div>
      </fieldset>
    </form>
  );
}
