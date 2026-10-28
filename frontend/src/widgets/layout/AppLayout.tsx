import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { roleNames, useSession } from "@/shared/model/session";

export function AppLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    if (leaving) return;
    setLeaving(true);
    setError("");
    try {
      await session.signOut();
      navigate("/", { replace: true });
    } catch {
      setError("Не удалось выйти. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setLeaving(false);
    }
  }
  return (
    <>
      <a className="skip-link" href="#main">
        К содержимому
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <Link className="brand" to="/" aria-label="ShiftHelper — на главную">
            <span className="brand-mark" aria-hidden="true">
              sh.
            </span>
            ShiftHelper<span className="brand-dot">●</span>
          </Link>
          <nav className="main-nav" aria-label="Основная навигация">
            <NavLink to="/" end>
              Главная
            </NavLink>
            <NavLink to="/catalog">Подработки</NavLink>
            {session.user && <NavLink to="/my-gigs">Мои задания</NavLink>}
          </nav>
          <div className="account-nav">
            {session.isPending ? (
              <span className="muted small" role="status">
                Проверяем вход…
              </span>
            ) : session.isError ? (
              <button
                className="text-button"
                onClick={() => void session.refresh()}
              >
                Повторить проверку входа
              </button>
            ) : session.user ? (
              <>
                {session.user.role === "customer" && (
                  <Link className="button button-small" to="/gigs/new">
                    + Задание
                  </Link>
                )}
                <Link className="account-link" to="/profile">
                  <span className="avatar" aria-hidden="true">
                    {Array.from(session.user.name)[0]}
                  </span>
                  <span className="account-name">
                    {session.user.name}
                    <small>{roleNames[session.user.role]}</small>
                  </span>
                </Link>
                <button
                  className="text-button"
                  onClick={() => void signOut()}
                  disabled={leaving}
                >
                  {leaving ? "Выходим…" : "Выйти"}
                </button>
              </>
            ) : (
              <>
                <Link className="text-link" to="/login">
                  Войти
                </Link>
                <Link className="button button-small" to="/register">
                  Начать <span aria-hidden="true">↗</span>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      {error && (
        <div className="container">
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        </div>
      )}
      {session.expired && (
        <div className="container">
          <p className="notice" role="status">
            Сессия истекла. Войдите снова, чтобы продолжить.
          </p>
        </div>
      )}
      <main id="main" className="container page-content">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container footer-inner">
          <span className="footer-brand">ShiftHelper</span>
          <span>Подработка в вашем ритме.</span>
          <a href="/docs/swagger.html">
            Документация API <span aria-hidden="true">↗</span>
          </a>
        </div>
      </footer>
    </>
  );
}
