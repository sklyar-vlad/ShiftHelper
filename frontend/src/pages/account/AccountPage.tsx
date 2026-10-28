import { roleNames, useSession } from "@/shared/model/session";

export function AccountPage() {
  const { user } = useSession();
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
      </section>
    </div>
  );
}
