import telegram from "./social-icons/telegram.svg?no-inline";
import vk from "./social-icons/vk.svg?no-inline";
import youtube from "./social-icons/youtube.svg?no-inline";
import rutube from "./social-icons/rutube.svg?no-inline";
import "./home-socials.css";

const icons = [
  ["Telegram", telegram],
  ["VK", vk],
  ["YouTube", youtube],
  ["Rutube", rutube],
] as const;

export function HomeSocials() {
  return (
    <section className="home-socials" aria-labelledby="home-socials-title">
      <h2 id="home-socials-title">
        Подписывайся на наши социальные сети и получай{" "}
        <span>актуальные предложения</span>
      </h2>
      <ul className="home-socials-icons">
        {icons.map(([name, src]) => (
          <li key={name}>
            <img src={src} alt={name} draggable={false} />
          </li>
        ))}
      </ul>
      <p>Сообщества пока не подключены.</p>
    </section>
  );
}
