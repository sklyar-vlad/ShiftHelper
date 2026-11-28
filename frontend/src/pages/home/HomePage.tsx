import { Link } from "react-router";
import { useSession } from "@/shared/model/session";
import { WorkPreview } from "@/shared/ui/WorkPreview";
import { HomeFaq } from "./HomeFaq";
import { HomeReviews } from "./HomeReviews";
import { HomeSocials } from "./HomeSocials";
import { HomeSteps } from "./HomeSteps";

export function HomePage() {
  const { user } = useSession();
  return (
    <>
      <section className="home-hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="live-dot" /> Больше свободы в каждом дне
          </p>
          <h1>
            Работа, которая
            <br />
            <span>подходит тебе.</span>
          </h1>
          <p className="lead">
            На пару часов или несколько недель. Находите подработку и людей для
            своих задач — в удобное время, на понятных условиях.
          </p>
          <div className="hero-actions">
            <Link className="button" to="/catalog">
              Найти подработку <span aria-hidden="true">↗</span>
            </Link>
            <Link
              className="button button-secondary"
              to={
                user?.role === "customer"
                  ? "/gigs/new"
                  : user
                    ? "/my-gigs"
                    : "/register"
              }
            >
              {user?.role === "worker" ? "Мои задания" : "Найти исполнителя"}
            </Link>
          </div>
          <p className="hero-note">Ваш график. Ваш выбор. Ваш ShiftHelper.</p>
        </div>
        <div className="hero-art">
          <WorkPreview />
        </div>
      </section>
      <div className="home-ticker" aria-label="Как работает ShiftHelper">
        <span>Понятные условия</span>
        <b aria-hidden="true">✳</b>
        <span>Гибкий график</span>
        <b aria-hidden="true">✳</b>
        <span>Прямые договорённости</span>
        <b aria-hidden="true">✳</b>
        <span>Взаимные отзывы</span>
      </div>
      <HomeSteps />
      <HomeReviews />
      <HomeFaq />
      <HomeSocials />
    </>
  );
}
