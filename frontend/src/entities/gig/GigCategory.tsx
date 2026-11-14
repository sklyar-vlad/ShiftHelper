import {
  useListGigCategories,
  type CategoryCode,
} from "@/shared/api/generated/api";

export function useGigCategories() {
  return useListGigCategories({ query: { staleTime: Infinity, retry: false } });
}

export function CategoryName({ code = "other" }: { code?: CategoryCode }) {
  const query = useGigCategories();
  const category = Array.isArray(query.data)
    ? query.data.find((item) => item.code === code)
    : undefined;
  return (
    <>
      {category?.name ??
        (code === "other"
          ? "Другое"
          : query.isPending
            ? "Загружаем категорию…"
            : "Категория недоступна")}
    </>
  );
}

export function GigCategory({ code }: { code?: CategoryCode }) {
  return (
    <span className="badge category-badge">
      <CategoryName code={code} />
    </span>
  );
}
