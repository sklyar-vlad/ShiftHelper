import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router";
import { roleNames, useSession } from "@/shared/model/session";
import { SiteFooter } from "./SiteFooter";
import { BrandLink } from "./BrandLink";
import { NotificationBell } from "./NotificationBell";

const mainSections = new Set(["/", "/catalog", "/my-gigs"]);

export function AppLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const { key, pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const main = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);

  useLayoutEffect(() => {
    const from = previousPath.current;
    previousPath.current = pathname;
    if (
      from === pathname ||
      hash ||
      !mainSections.has(from) ||
      !mainSections.has(pathname) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const animation = main.current?.animate?.(
      [{ opacity: 0.8 }, { opacity: 1 }],
      {
        duration: 180,
        easing: "ease-out",
      },
    );
    return () => animation?.cancel();
  }, [hash, pathname]);

  useEffect(() => {
    if (pathname !== "/" || !hash) return;
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    const smooth =
      navigationType !== "POP" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
    target.focus({ preventScroll: true });
  }, [hash, key, navigationType, pathname]);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
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
        <div className="container header-inner" data-menu-open={menuOpen}>
          <BrandLink label="ShiftHelper — на главную" />
          <div className="header-controls">
            {session.user && (
              <NotificationBell
                key={session.user.id}
                userId={session.user.id}
              />
            )}
            <button
              className="menu-toggle"
              type="button"
              aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={menuOpen}
              aria-controls="main-navigation account-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d={
                    menuOpen
                      ? "m6 6 12 12M18 6 6 18"
                      : "M4 6h16M4 12h16M4 18h16"
                  }
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <nav
            className="main-nav"
            id="main-navigation"
            aria-label="Основная навигация"
            onClick={() => setMenuOpen(false)}
          >
            <NavLink to="/" end>
              Главная
            </NavLink>
            <NavLink to="/catalog">Подработки</NavLink>
            {session.user && <NavLink to="/my-gigs">Мои задания</NavLink>}
          </nav>
          <div
            className="account-nav"
            id="account-navigation"
            onClick={() => setMenuOpen(false)}
          >
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
                <Link
                  className="account-link"
                  to="/profile"
                  aria-label={`Мой профиль: ${session.user.name}`}
                >
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
                <Link
                  className="button button-small button-mint"
                  to="/register"
                >
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
      <main id="main" className="container page-content" ref={main}>
        <Outlet />
      </main>
      <SiteFooter role={session.user?.role} />
    </>
  );
}
