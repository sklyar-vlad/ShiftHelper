import { expect, it } from "vitest";
import { apiDate, localDate, parseLocalDateTime } from "./dates";

it("round-trips local days and clocks without losing unchanged API microseconds", () => {
  const original = "2026-01-01T09:00:00.123456+03:00";
  const local = localDate(original);
  expect(apiDate(local, original)).toBe(original);
  expect(new Date(apiDate(local)!).getTime()).toBe(
    new Date(original).getTime(),
  );
});
it.each([
  "",
  "2028-02-30T10:00",
  "2028-02-29T25:00",
  "2028-02-29T",
  "T12:00",
  "not a date",
])("rejects incomplete or invalid local date %s", (value) => {
  expect(parseLocalDateTime(value)).toBeNull();
  expect(apiDate(value)).toBeNull();
});
it("keeps seconds and milliseconds for edited dates", () => {
  const value = "2028-02-29T23:59:12.345";
  expect(localDate(apiDate(value)!)).toBe(value);
});
