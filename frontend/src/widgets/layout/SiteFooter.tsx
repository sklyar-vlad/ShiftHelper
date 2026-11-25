import { Link } from "react-router";
import { SocialIcons } from "@/shared/ui/SocialIcons";
import { BrandLink } from "./BrandLink";
import "./site-footer.css";

export function SiteFooter({ role }: { role?: "worker" | "customer" }) {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-columns">
          <div className="footer-about">
            <BrandLink label="ShiftHelper, главная страница" />
            <SocialIcons className="footer-socials" />
            <p>
              ShiftHelper помогает находить подработки и исполнителей для
              разовых задач.
            </p>
          </div>
          <nav aria-labelledby="footer-workers">
            <h2 id="footer-workers">Исполнителям</h2>
            <Link to="/catalog">Каталог заданий</Link>
            <Link to="/#how-it-works">Как это работает</Link>
            <Link to="/#reviews">Отзывы о платформе</Link>
            {role === "worker" && (
              <Link to="/my-gigs">Личный кабинет исполнителя</Link>
            )}
          </nav>
          <nav aria-labelledby="footer-customers">
            <h2 id="footer-customers">Заказчикам</h2>
            {role === "customer" && (
              <>
                <Link to="/gigs/new">Создать задание</Link>
                <Link to="/my-gigs">Мои публикации</Link>
              </>
            )}
            {!role && <Link to="/register">Зарегистрироваться</Link>}
            <Link to="/#faq">Ответы на вопросы</Link>
          </nav>
          <section aria-labelledby="footer-contact">
            <h2 id="footer-contact">Контакты</h2>
            <address>
              Санкт-Петербург,
              <br />
              Большая Морская улица, 67
            </address>
            <a className="footer-docs" href="/docs/swagger.html">
              Документация API
            </a>
          </section>
        </div>
        <p className="footer-copyright">
          © {new Date().getFullYear()} ShiftHelper
        </p>
      </div>
    </footer>
  );
}
