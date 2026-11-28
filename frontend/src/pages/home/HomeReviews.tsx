import { useState } from "react";
import darya from "./review-avatars/darya.webp";
import irina from "./review-avatars/irina.webp";
import maksim from "./review-avatars/maksim.webp";
import "./home-reviews.css";

const reviews = [
  {
    name: "Ирина",
    role: "Заказчик",
    photo: irina,
    quote:
      "Нужно было разобрать вещи после переезда. Я описала задачу, указала время и выбрала человека из тех, кто откликнулся. Было удобно, что все условия остались в одном месте.",
  },
  {
    name: "Максим",
    role: "Помощь с переездами",
    photo: maksim,
    quote:
      "Искал подработку на выходные. В каталоге сразу увидел, где и когда нужна помощь, и откликнулся на подходящее задание.",
  },
  {
    name: "Дарья",
    role: "Помощь на мероприятиях",
    photo: darya,
    quote:
      "Накануне мероприятия сдвинулось время начала. Заказчик прислал новые условия, я их посмотрела и подтвердила. Потом мы отметили выполнение и обменялись отзывами.",
  },
] as const;

export function HomeReviews() {
  const [{ index, previous, direction }, setSlide] = useState({
    index: 0,
    previous: -1,
    direction: "",
  });

  function move(step: -1 | 1) {
    setSlide(({ index }) => ({
      index: (index + step + reviews.length) % reviews.length,
      previous: index,
      direction: step === 1 ? "next" : "previous",
    }));
  }

  return (
    <section
      id="reviews"
      tabIndex={-1}
      className="home-reviews"
      aria-labelledby="reviews-title"
    >
      <h2 id="reviews-title">Отзывы</h2>
      <p className="home-reviews-label">Демонстрационные отзывы</p>
      <div
        className="home-reviews-slides"
        data-direction={direction || undefined}
      >
        {reviews.map(({ name, role, photo, quote }, position) => (
          <figure
            key={name}
            className="home-reviews-slide"
            aria-hidden={index !== position}
            data-leaving={previous === position}
          >
            <blockquote>
              <p>«{quote}»</p>
            </blockquote>
            <figcaption>
              <img src={photo} alt="" width="116" height="116" loading="lazy" />
              <strong>{name}</strong>
              <span>{role}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="home-reviews-controls">
        <button type="button" aria-label="Назад" onClick={() => move(-1)}>
          <span aria-hidden="true">←</span>
        </button>
        <span role="status">
          {index + 1} из {reviews.length}
        </span>
        <button type="button" aria-label="Далее" onClick={() => move(1)}>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
