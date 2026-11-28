import { SocialIcons } from "@/shared/ui/SocialIcons";
import "./home-socials.css";

export function HomeSocials() {
  return (
    <section className="home-socials" aria-labelledby="home-socials-title">
      <h2 id="home-socials-title">
        Подписывайся на наши социальные сети и получай{" "}
        <span>актуальные предложения</span>
      </h2>
      <SocialIcons className="home-socials-icons" />
      <p>Сообщества пока не подключены.</p>
    </section>
  );
}
