import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CityInput } from "./CityInput";
import { loadCities, prepareCities } from "@/shared/lib/cities";
vi.mock("@/shared/lib/cities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/cities")>()),
  loadCities: vi.fn(),
}));
const data = prepareCities([
  ["Москва", "Москва"],
  ["Киров", "Калужская область"],
  ["Киров", "Кировская область"],
  ["Орёл", "Орловская область"],
]);
afterEach(() => {
  cleanup();
  vi.mocked(loadCities).mockReset();
});
function mount() {
  vi.mocked(loadCities).mockResolvedValue(data);
  const change = vi.fn();
  render(
    <form>
      <label htmlFor="city">Город</label>
      <CityInput id="city" name="city" onValueChange={change} />
      <button>Найти</button>
    </form>,
  );
  return change;
}
it("selects by keyboard and pointer, then closes on Escape and Tab", async () => {
  const change = mount();
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "Ки" } });
  await screen.findAllByRole("option");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input.getAttribute("aria-activedescendant")).toBe(
    screen.getAllByRole("option")[0].id,
  );
  fireEvent.keyDown(input, { key: "Enter" });
  expect(change).toHaveBeenLastCalledWith("Киров, Калужская область");
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.change(input, { target: { value: "Ки" } });
  fireEvent.click(screen.getAllByRole("option")[1]);
  expect(change).toHaveBeenLastCalledWith("Киров, Кировская область");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "Tab" });
  expect(screen.queryByRole("listbox")).toBeNull();
});
it("allows unmatched historical values and clearing without forcing a selection", async () => {
  const change = mount();
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "Старый город" } });
  await screen.findByText("Ничего не найдено. Можно ввести свой город.");
  expect(change).toHaveBeenLastCalledWith("Старый город");
  expect(
    new FormData(screen.getByRole("button").closest("form")!).get("city"),
  ).toBe("Старый город");
  fireEvent.change(input, { target: { value: "" } });
  expect(change).toHaveBeenLastCalledWith("");
  expect(screen.queryByRole("listbox")).toBeNull();
});
it("keeps manual entry usable when the local snapshot fails to load", async () => {
  vi.mocked(loadCities).mockRejectedValue(new Error("chunk unavailable"));
  render(<CityInput aria-label="Город" name="city" />);
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "Москва" },
  });
  await screen.findByText("Подсказки недоступны. Введите город вручную.");
  await waitFor(() =>
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe(
      "Москва",
    ),
  );
});
