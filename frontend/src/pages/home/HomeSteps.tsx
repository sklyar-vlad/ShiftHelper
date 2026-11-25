import profile from "./step-art/profile.svg";
import search from "./step-art/search.svg";
import done from "./step-art/done.svg";
import "./home-steps.css";

const steps = [
  [profile, "Зарегистрироваться", "Создайте профиль исполнителя на сайте."],
  [search, "Выбрать", "Найдите подходящее задание и отправьте отклик."],
  [
    done,
    "Выполнить",
    "Выполните работу, сдайте её и дождитесь подтверждения заказчика.",
  ],
] as const;

export function HomeSteps() {
  return (
    <section
      id="how-it-works"
      className="home-steps"
      aria-labelledby="home-steps-title"
    >
      <h2 id="home-steps-title">Выполнить задание просто!</h2>
      <ol>
        {steps.map(([image, title, description]) => (
          <li key={title}>
            <img src={image} alt="" width="172" height="172" />
            <h3>{title}</h3>
            <p>{description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
