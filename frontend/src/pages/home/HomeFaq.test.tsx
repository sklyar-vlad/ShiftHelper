import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { HomeFaq } from "./HomeFaq";

afterEach(cleanup);

it("starts collapsed and opens only one answer at a time", () => {
  render(<HomeFaq />);
  const faq = screen.getByRole("region", { name: "Ответы на вопросы" });
  const buttons = within(faq).getAllByRole("button", { expanded: false });
  const panels = buttons.map((button) =>
    document.getElementById(button.getAttribute("aria-controls")!),
  );
  expect(buttons).toHaveLength(10);
  expect(new Set(panels).size).toBe(buttons.length);
  expect(panels.every((panel) => panel?.hidden)).toBe(true);

  const [first, second] = buttons;
  first.focus();
  expect(document.activeElement).toBe(first);
  fireEvent.click(first);
  expect(first.getAttribute("aria-expanded")).toBe("true");
  expect(panels[0]?.hidden).toBe(false);

  fireEvent.click(second);
  expect(first.getAttribute("aria-expanded")).toBe("false");
  expect(panels[0]?.hidden).toBe(true);
  expect(panels[1]?.hidden).toBe(false);

  fireEvent.click(second);
  expect(within(faq).queryByRole("button", { expanded: true })).toBeNull();
  expect(panels[1]?.hidden).toBe(true);
});
