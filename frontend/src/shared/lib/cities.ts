export type City = { name: string; region: string; value: string };
export const normalizeCity = (value: string) =>
  value.trim().toLocaleLowerCase("ru").replaceAll("ё", "е");

export function prepareCities(rows: string[][]): City[] {
  const counts = new Map<string, number>();
  for (const [name] of rows)
    counts.set(normalizeCity(name), (counts.get(normalizeCity(name)) ?? 0) + 1);
  return rows.map(([name, region]) => ({
    name,
    region,
    value: counts.get(normalizeCity(name))! > 1 ? `${name}, ${region}` : name,
  }));
}
export async function loadCities(): Promise<City[]> {
  const { default: data } = await import("./cities.json");
  return prepareCities(data.cities);
}
export function searchCities(cities: City[], input: string): City[] {
  const query = normalizeCity(input);
  if (query.length < 2) return [];
  return cities
    .filter((city) =>
      normalizeCity(`${city.name}, ${city.region}`).includes(query),
    )
    .sort(
      (a, b) =>
        Number(normalizeCity(b.name).startsWith(query)) -
        Number(normalizeCity(a.name).startsWith(query)),
    )
    .slice(0, 8);
}
