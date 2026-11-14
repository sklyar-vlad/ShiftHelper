import { expect, it } from "vitest";
import {
  catalogPage,
  catalogQuery,
  emptyFilters,
  filterUrl,
  readFilters,
} from "./filters";

it("round-trips filters through the URL and keeps them across pages", () => {
  const filters = {
    ...emptyFilters,
    q: "коробки",
    city: "Киров, Калужская область",
    category: "moving",
    minPay: "1234,56",
    maxPay: "2000",
    dateFrom: "2028-02-29",
    dateTo: "2028-03-01",
    duration: "240",
    sort: "nearest",
  };
  const url = new URL(filterUrl(filters, 3), "http://localhost");
  expect(readFilters(url.searchParams)).toEqual(filters);
  expect(catalogPage(url.searchParams)).toBe(3);
  expect(
    new URL(filterUrl(filters), "http://localhost").searchParams.has("page"),
  ).toBe(false);
  expect(filterUrl(emptyFilters)).toBe("/catalog");
});

it("converts decimal rubles to exact integer kopecks, including zero and the upper limit", () => {
  for (const [input, amount] of [
    ["0", 0],
    ["0,01", 1],
    ["1234.56", 123456],
    ["0001.2", 120],
    ["100000000", 10000000000],
  ] as const) {
    const result = catalogQuery({
      ...emptyFilters,
      minPay: input,
      maxPay: input,
    });
    expect(result.valid).toBe(true);
    expect(result.params.minAmountKopecks).toBe(amount);
    expect(result.params.maxAmountKopecks).toBe(amount);
  }
});

it("uses local midnight and the next calendar day for inclusive date filters", () => {
  const result = catalogQuery({
    ...emptyFilters,
    dateFrom: "2028-02-29",
    dateTo: "2028-02-29",
  });
  expect(result.valid).toBe(true);
  const from = new Date(result.params.startsFrom!);
  const before = new Date(result.params.startsBefore!);
  expect([
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
    from.getHours(),
  ]).toEqual([2028, 1, 29, 0]);
  expect([
    before.getFullYear(),
    before.getMonth(),
    before.getDate(),
    before.getHours(),
  ]).toEqual([2028, 2, 1, 0]);
  expect(result.params.startsFrom).toMatch(/Z$/);
  expect(
    catalogQuery({ ...emptyFilters, dateTo: "2028-12-31" }).params.startsBefore,
  ).toBe(new Date(2029, 0, 1).toISOString());
});

it.each([
  { minPay: "-1" },
  { minPay: "1.001" },
  { maxPay: "100000000.01" },
  { minPay: "1e3" },
  { minPay: "Infinity" },
  { minPay: "1", maxPay: "0" },
  { dateFrom: "2027-02-29" },
  { dateTo: "2028-02-30" },
  { dateFrom: "2028-03-01", dateTo: "2028-02-29" },
  { dateFrom: "0000-01-01" },
  { duration: "121" },
  { duration: "toString" },
  { sort: "__proto__" },
  { sort: "bad" },
  { category: "bad" },
  { q: "a\u0000b" },
])("rejects invalid values without sending an API request: %o", (patch) => {
  expect(
    catalogQuery({ ...emptyFilters, ...patch }, 1, ["moving", "other"]).valid,
  ).toBe(false);
});

it.each(["-1", "0", "1.5", "2147483648", "bad"])(
  "uses the first page for invalid page %s",
  (page) => {
    expect(catalogPage(new URLSearchParams({ page }))).toBe(1);
  },
);
