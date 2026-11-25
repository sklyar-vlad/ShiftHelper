import telegram from "./social-icons/telegram.svg?no-inline";
import vk from "./social-icons/vk.svg?no-inline";
import youtube from "./social-icons/youtube.svg?no-inline";
import rutube from "./social-icons/rutube.svg?no-inline";

const icons = [
  ["Telegram", telegram],
  ["VK", vk],
  ["YouTube", youtube],
  ["Rutube", rutube],
] as const;

export function SocialIcons({ className }: { className: string }) {
  return (
    <ul className={className}>
      {icons.map(([name, src]) => (
        <li key={name}>
          <img src={src} alt={name} draggable={false} />
        </li>
      ))}
    </ul>
  );
}
