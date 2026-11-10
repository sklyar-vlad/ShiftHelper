import { expect, it } from "vitest";
import data from "./cities.json";
import { normalizeCity, prepareCities, searchCities } from "./cities";

const cities = prepareCities(data.cities);
it("retains the licensed snapshot without missing, duplicate or ambiguous values", () => {
  expect(data.license).toBe("CC BY-SA 4.0");
  expect(data.revision).toBe("ae661bffe572880472249097c9b29c42b09650ea");
  expect(cities).toHaveLength(1117);
  expect(new Set(cities.map((city) => city.region)).size).toBe(85);
  expect(new Set(cities.map((city) => normalizeCity(city.value))).size).toBe(
    cities.length,
  );
  expect(
    cities.every(
      (city) =>
        city.name.trim() &&
        city.region.trim() &&
        Array.from(city.value).length <= 100,
    ),
  ).toBe(true);
  for (const name of [
    "Москва",
    "Санкт-Петербург",
    "Истра",
    "Алупка",
    "Урус-Мартан",
    "Анадырь",
    "Нарьян-Мар",
    "Ханты-Мансийск",
    "Салехард",
  ])
    expect(cities.some((city) => city.name === name)).toBe(true);
});
it("matches case, whitespace and е/ё, ranks prefixes and limits output", () => {
  expect(searchCities(cities, "  ОРЁ  ")).toEqual(searchCities(cities, "оре"));
  expect(searchCities(cities, "  мо ")[0].name.startsWith("Мо")).toBe(true);
  expect(searchCities(cities, "ск").length).toBeLessThanOrEqual(8);
  expect(searchCities(cities, "м")).toEqual([]);
  expect(searchCities(cities, "несуществующийгород")).toEqual([]);
});
it("distinguishes identical names by region while leaving unique names compatible", () => {
  expect(cities.find((city) => city.name === "Москва")?.value).toBe("Москва");
  const kirov = cities.filter((city) => city.name === "Киров");
  expect(kirov.map((city) => city.value)).toEqual([
    "Киров, Калужская область",
    "Киров, Кировская область",
  ]);
});
