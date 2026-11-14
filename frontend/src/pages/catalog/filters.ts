import type { ListGigsParams, ListGigsSort } from "@/shared/api/generated/api";

export const sortLabels = {
  newest: "Новые",
  nearest: "Ближайшее начало",
  amount_asc: "Дешевле",
  amount_desc: "Дороже",
};
export const durationLabels = {
  "120": "До 2 часов",
  "240": "До 4 часов",
  "480": "До 8 часов",
};
export const emptyFilters = {
  q: "",
  city: "",
  category: "",
  minPay: "",
  maxPay: "",
  dateFrom: "",
  dateTo: "",
  duration: "",
  sort: "newest",
};
export type Filters = typeof emptyFilters;
export type FilterErrors = Partial<Record<keyof Filters, string>>;

export function readFilters(search: URLSearchParams): Filters {
  return Object.fromEntries(
    Object.entries(emptyFilters).map(([key, fallback]) => [
      key,
      search.get(key) ?? fallback,
    ]),
  ) as Filters;
}

export function filterUrl(filters: Filters, page = 1) {
  const search = new URLSearchParams();
  for (const key of Object.keys(emptyFilters) as (keyof Filters)[]) {
    const value = filters[key].trim();
    if (value && value !== emptyFilters[key]) search.set(key, value);
  }
  if (page > 1) search.set("page", String(page));
  return `/catalog${search.size ? `?${search}` : ""}`;
}

function kopecks(value: string) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) return NaN;
  const [rubles, fraction = ""] = value.replace(",", ".").split(".");
  const amount = Number(rubles) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount <= 10000000000 ? amount : NaN;
}

function midnight(value: string, nextDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (
    year < 1 ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    return undefined;
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999
    ? date.toISOString()
    : undefined;
}

export function catalogQuery(
  filters: Filters,
  page = 1,
  categories?: string[],
) {
  const errors: FilterErrors = {};
  const params: ListGigsParams = { page, pageSize: 20 };
  for (const [field, limit] of [
    ["q", 150],
    ["city", 100],
  ] as const) {
    const value = filters[field].trim();
    if (
      [...value].length > limit ||
      [...value].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      errors[field] = `Не больше ${limit} символов, без управляющих знаков.`;
    if (value) params[field] = value;
  }
  if (filters.category) {
    params.category = filters.category;
    if (categories && !categories.includes(filters.category))
      errors.category = "Выберите доступную категорию.";
  }
  for (const [field, key] of [
    ["minPay", "minAmountKopecks"],
    ["maxPay", "maxAmountKopecks"],
  ] as const) {
    if (!filters[field].trim()) continue;
    const amount = kopecks(filters[field].trim());
    if (!Number.isFinite(amount))
      errors[field] =
        "От 0 до 100 000 000 ₽, не больше двух знаков после запятой.";
    else params[key] = amount;
  }
  if (
    params.minAmountKopecks !== undefined &&
    params.maxAmountKopecks !== undefined &&
    params.minAmountKopecks > params.maxAmountKopecks
  )
    errors.maxPay = "Оплата до должна быть не меньше оплаты от.";
  for (const [field, key] of [
    ["dateFrom", "startsFrom"],
    ["dateTo", "startsBefore"],
  ] as const) {
    if (!filters[field]) continue;
    const date = midnight(filters[field], field === "dateTo");
    if (!date) errors[field] = "Укажите корректную дату.";
    else params[key] = date;
  }
  if (
    params.startsFrom &&
    params.startsBefore &&
    params.startsFrom >= params.startsBefore
  )
    errors.dateTo = "Дата до должна быть не раньше даты от.";
  if (filters.duration) {
    if (!Object.hasOwn(durationLabels, filters.duration))
      errors.duration = "Выберите длительность из списка.";
    else params.maxDurationMinutes = Number(filters.duration);
  }
  if (!Object.hasOwn(sortLabels, filters.sort))
    errors.sort = "Выберите сортировку из списка.";
  else params.sort = filters.sort as ListGigsSort;
  return { params, errors, valid: Object.keys(errors).length === 0 };
}

export function catalogPage(search: URLSearchParams) {
  const value = Number(search.get("page") ?? 1);
  return Number.isInteger(value) && value > 0 && value <= 2147483647
    ? value
    : 1;
}
