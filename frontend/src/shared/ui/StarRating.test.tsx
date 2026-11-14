import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StarRating } from "./StarRating";

afterEach(cleanup);

function ControlledRating() {
  const [value, setValue] = useState<number | null>(5);
  return <StarRating value={value} onChange={setValue} />;
}

it("previews a lower rating without changing the saved selection", () => {
  const onChange = vi.fn();
  const view = render(<StarRating value={5} onChange={onChange} />);
  const radios = screen.getAllByRole("radio") as HTMLInputElement[];
  expect(radios.map((radio) => radio.value)).toEqual(["1", "2", "3", "4", "5"]);
  fireEvent.mouseEnter(radios[1].closest("label")!);
  expect(view.container.querySelectorAll("label.is-filled")).toHaveLength(2);
  expect(radios[4].checked).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.mouseLeave(screen.getByRole("group", { name: "Оценка" }));
  expect(view.container.querySelectorAll("label.is-filled")).toHaveLength(5);
});

it("clears pointer preview on keyboard selection and wraps at both ends", () => {
  const view = render(<ControlledRating />);
  const radios = screen.getAllByRole("radio") as HTMLInputElement[];
  fireEvent.mouseEnter(radios[1].closest("label")!);
  fireEvent.keyDown(radios[4], { key: "ArrowRight" });
  expect(radios[0].checked).toBe(true);
  expect(document.activeElement).toBe(radios[0]);
  expect(view.container.querySelectorAll("label.is-filled")).toHaveLength(1);
  fireEvent.keyDown(radios[0], { key: "ArrowLeft" });
  expect(radios[4].checked).toBe(true);
  expect(document.activeElement).toBe(radios[4]);
});

it("ignores interaction while a submission is pending", () => {
  const onChange = vi.fn();
  const view = render(<StarRating value={5} onChange={onChange} />);
  const radios = screen.getAllByRole("radio");
  fireEvent.mouseEnter(radios[1].closest("label")!);
  view.rerender(<StarRating value={5} onChange={onChange} disabled />);
  fireEvent.mouseEnter(radios[0].closest("label")!);
  fireEvent.keyDown(radios[4], { key: "ArrowLeft" });
  expect(view.container.querySelectorAll("label.is-filled")).toHaveLength(5);
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps radio groups independent when several ratings share a form", () => {
  render(
    <form>
      <StarRating value={1} onChange={() => {}} />
      <StarRating value={5} onChange={() => {}} />
    </form>,
  );
  const radios = screen.getAllByRole("radio") as HTMLInputElement[];
  expect(radios[0].name).not.toBe(radios[5].name);
  expect(radios[0].checked).toBe(true);
  expect(radios[9].checked).toBe(true);
});
