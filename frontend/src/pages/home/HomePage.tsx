import { Link } from "react-router";
import { useSession } from "@/shared/model/session";

export function HomePage() {
  const { user } = useSession();
  return (
    <>
      <section className="home-hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="live-dot" />
            Работа под ваш график
          </p>
          <h1>
            Новый день.
            <br />
            Новые <span className="text-green">возможности.</span>
          </h1>
          <p className="lead">
            Подработка на несколько часов или недель. Найдите своё дело — и
            договоритесь с заказчиком напрямую.
          </p>
          <div className="hero-actions">
            <Link className="button" to={user ? "/profile" : "/register"}>
              {user ? "В мой профиль" : "Создать аккаунт"}
              <span aria-hidden="true">↗</span>
            </Link>
            <span className="hero-note">
              Начните с малого.
              <br />
              Выбирайте то, что подходит.
            </span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="art-star">✳</span>
          <div className="art-ticket">
            <span className="ticket-label">ВАШ НОВЫЙ РИТМ</span>
            <span className="ticket-icon">↗</span>
            <strong>
              Дело найдётся.
              <br />
              Время — за вами.
            </strong>
            <div className="ticket-divider" />
            <div className="ticket-bottom">
              <span>
                Несколько часов
                <br />
                <b>или несколько недель</b>
              </span>
              <span className="ticket-round">sh.</span>
            </div>
          </div>
          <span className="art-caption">Больше свободы в каждом дне.</span>
        </div>
      </section>
      <section className="how-section" aria-labelledby="how-title">
        <div className="section-heading">
          <p className="eyebrow">Без лишних сложностей</p>
          <h2 id="how-title">Начать проще, чем кажется</h2>
        </div>
        <div className="steps-grid">
          {[
            [
              "01",
              "Выберите свою роль",
              "Ищите подработку или находите исполнителей для своих задач.",
            ],
            [
              "02",
              "Найдите совпадение",
              "Ознакомьтесь с условиями и договоритесь о работе.",
            ],
            [
              "03",
              "Сделайте дело",
              "Выполните задание и подтвердите результат вместе.",
            ],
          ].map(([number, title, text]) => (
            <article className="step-card" key={number}>
              <span className="step-number">{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
