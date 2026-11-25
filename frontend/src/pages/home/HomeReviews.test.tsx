import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { HomeReviews } from "./HomeReviews";
import darya from "./review-avatars/darya.webp";
import irina from "./review-avatars/irina.webp";
import maksim from "./review-avatars/maksim.webp";

afterEach(cleanup);

it("cycles in both directions with the matching text and portrait", () => {
  render(<HomeReviews />);
  const next = screen.getByRole("button", { name: "Далее" });
  const back = screen.getByRole("button", { name: "Назад" });

  function check(
    position: number,
    name: string,
    role: string,
    quote: RegExp,
    photo: string,
  ) {
    const slide = screen.getByRole("figure");
    expect(within(slide).getByText(name)).toBeTruthy();
    expect(within(slide).getByText(role)).toBeTruthy();
    expect(within(slide).getByText(quote)).toBeTruthy();
    expect(slide.querySelector("img")?.getAttribute("src")).toBe(photo);
    expect(screen.getByRole("status").textContent).toBe(`${position} из 3`);
  }

  check(1, "Ирина", "Заказчик", /разобрать вещи после переезда/, irina);
  fireEvent.click(back);
  check(3, "Дарья", "Помощь на мероприятиях", /сдвинулось время/, darya);
  fireEvent.click(next);
  check(1, "Ирина", "Заказчик", /разобрать вещи после переезда/, irina);
  fireEvent.click(next);
  check(2, "Максим", "Помощь с переездами", /подработку на выходные/, maksim);
  act(() => {
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(back);
  });
  check(3, "Дарья", "Помощь на мероприятиях", /сдвинулось время/, darya);
});
