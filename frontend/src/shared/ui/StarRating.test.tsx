import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StarRating } from "./StarRating";

afterEach(cleanup);
function mount(disabled = false) {
  const change = vi.fn();
  function Form() {
    const [value, setValue] = useState<number | null>(null);
    return (
      <StarRating
        value={value}
        onChange={(next) => {
          setValue(next);
          change(next);
        }}
        disabled={disabled}
      />
    );
  }
  render(<Form />);
  return change;
}
it("selects a radio by keyboard and describes the score in words", async () => {
  const change = mount();
  expect(screen.getByRole("radiogroup", { name: "Оценка" })).toBeTruthy();
  const first = screen.getByRole("radio", { name: /^1 из 5/ });
  fireEvent.click(first);
  act(() => first.focus());
  fireEvent.keyDown(first, { key: "ArrowRight" });
  await waitFor(() => expect(change).toHaveBeenLastCalledWith(2));
  expect(
    (screen.getByRole("radio", { name: /^2 из 5/ }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  expect(screen.getByText("Плохо")).toBeTruthy();
  const second = screen.getByRole("radio", { name: /^2 из 5/ });
  act(() => second.focus());
  // Обратный обход TreeWalker в happy-dom сломан; ArrowLeft проверяет Playwright.
  fireEvent.keyDown(second, { key: "ArrowRight" });
  await waitFor(() => expect(change).toHaveBeenLastCalledWith(3));
});
it("previews on hover without changing the saved selection", async () => {
  const change = mount();
  fireEvent.click(screen.getByRole("radio", { name: /^3 из 5/ }));
  const last = screen.getByRole("radio", { name: /^5 из 5/ }).closest("label")!;
  fireEvent.pointerEnter(last, { pointerType: "mouse" });
  await waitFor(() => expect(last.getAttribute("data-filled")).toBe("true"));
  expect(change).toHaveBeenCalledTimes(1);
  expect(
    (screen.getByRole("radio", { name: /^3 из 5/ }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  expect(screen.getByText("Нормально")).toBeTruthy();
  fireEvent.pointerLeave(last, { pointerType: "mouse" });
  await waitFor(() => expect(last.getAttribute("data-filled")).toBe("false"));
});
it("disables all radios while a request is pending", () => {
  mount(true);
  for (const radio of screen.getAllByRole("radio"))
    expect((radio as HTMLInputElement).disabled).toBe(true);
});
