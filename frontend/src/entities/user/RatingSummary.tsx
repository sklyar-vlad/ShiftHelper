import type { PublicUser } from "@/shared/api/generated/api";

export function RatingSummary({
  user,
}: {
  user: Pick<PublicUser, "ratingAverage" | "reviewsCount">;
}) {
  return user.ratingAverage == null || !user.reviewsCount
    ? "Пока нет оценок"
    : `Рейтинг: ${user.ratingAverage.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} из 5 · Отзывов: ${user.reviewsCount}`;
}
