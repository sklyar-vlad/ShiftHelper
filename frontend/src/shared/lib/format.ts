const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
});
const dateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const formatMoney = (kopecks: number) => money.format(kopecks / 100);
export const formatDateTime = (value: string) =>
  dateTime.format(new Date(value));
