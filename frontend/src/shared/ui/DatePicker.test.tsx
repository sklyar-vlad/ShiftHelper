import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DatePicker } from "./DatePicker";

afterEach(cleanup);
function mount(props: Partial<React.ComponentProps<typeof DatePicker>> = {}) {
  const change = vi.fn();
  function Form() {
    const [value, setValue] = useState(props.value ?? "2028-02-28");
    return (
      <form>
        <DatePicker
          label="Дата работы"
          name="day"
          {...props}
          value={value}
          onChange={(next) => {
            setValue(next);
            change(next);
          }}
        />
        <output>{value}</output>
        <button type="button">Снаружи</button>
      </form>
    );
  }
  render(<Form />);
  return change;
}
async function open() {
  fireEvent.click(
    screen.getByRole("button", { name: "Открыть календарь Дата работы" }),
  );
  await screen.findByRole("dialog", { name: "Выбор даты: Дата работы" });
}
it("selects leap day as a calendar date and submits the same day", async () => {
  const change = mount();
  await open();
  fireEvent.click(screen.getByRole("button", { name: /29 февраля/ }));
  await waitFor(() => expect(change).toHaveBeenLastCalledWith("2028-02-29"));
  expect(new FormData(document.querySelector("form")!).get("day")).toBe(
    "2028-02-29",
  );
});
it("navigates across months and years without changing the value", async () => {
  const change = mount({ value: "2028-12-31" });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Следующий месяц" }));
  await screen.findByRole("heading", { name: /январь 2029/i });
  fireEvent.click(screen.getByRole("button", { name: "Предыдущий месяц" }));
  await screen.findByRole("heading", { name: /декабрь 2028/i });
  expect(change).not.toHaveBeenCalled();
});
it("enforces day bounds and disables Today when it is outside the allowed range", async () => {
  const change = mount({ min: "2028-02-28", max: "2028-02-29" });
  await open();
  const forbidden = screen.getByRole("button", { name: /27 февраля/ });
  expect(forbidden.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(forbidden);
  expect(change).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "Сегодня" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /29 февраля/ }));
  await waitFor(() => expect(change).toHaveBeenLastCalledWith("2028-02-29"));
});
it("moves by keyboard, selects with Enter and restores focus on Escape", async () => {
  const change = mount();
  const trigger = screen.getByRole("button", {
    name: "Открыть календарь Дата работы",
  });
  trigger.focus();
  await open();
  const selected = screen.getByRole("button", { name: /28 февраля/ });
  selected.focus();
  fireEvent.keyDown(selected, { key: "ArrowRight" });
  await waitFor(() =>
    expect(document.activeElement?.getAttribute("aria-label")).toContain(
      "29 февраля",
    ),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  fireEvent.keyUp(document.activeElement!, { key: "Enter" });
  await waitFor(() => expect(change).toHaveBeenLastCalledWith("2028-02-29"));
  await open();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
it("supports clearing, disabled fields and external validation errors", () => {
  const change = mount({ error: "Проверьте дату" });
  expect(screen.getByText("Проверьте дату")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Очистить дату: Дата работы" }),
  );
  expect(change).toHaveBeenLastCalledWith("");
  cleanup();
  mount({ disabled: true });
  expect(
    (
      screen.getByRole("button", {
        name: "Открыть календарь Дата работы",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it.each([
  ["2028-12-31", "2029-01-01"],
  ["2027-02-28", "2027-03-01"],
  ["2028-02-29", "2028-03-01"],
])("moves from %s to %s using arrow keys", async (value, next) => {
  const change = mount({ value });
  await open();
  const selected = document.querySelector<HTMLElement>(
    ".date-picker-day[data-selected]",
  )!;
  selected.focus();
  fireEvent.keyDown(selected, { key: "ArrowRight" });
  const text = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${next}T12:00:00`));
  await waitFor(() =>
    expect(document.activeElement?.getAttribute("aria-label")).toContain(text),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  fireEvent.keyUp(document.activeElement!, { key: "Enter" });
  await waitFor(() => expect(change).toHaveBeenLastCalledWith(next));
});
it("selects Today without a timezone conversion", async () => {
  const change = mount();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Сегодня" }));
  const now = new Date();
  const expected = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  await waitFor(() => expect(change).toHaveBeenLastCalledWith(expected));
});
