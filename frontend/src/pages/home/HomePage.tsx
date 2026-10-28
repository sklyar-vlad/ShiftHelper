import { useGetStatus } from "@/shared/api/generated/api";

export function HomePage() {
  const status = useGetStatus();
  return (
    <main>
      <p className="eyebrow">ShiftHelper</p>
      <h1>Подработка под ваш график</h1>
      <p className="lead">
        Платформа для поиска и выполнения краткосрочных работ — от нескольких
        часов до нескольких недель.
      </p>
      <section aria-labelledby="stage-title">
        <h2 id="stage-title">Проект в разработке</h2>
        <p>
          Готовим сервис, где заказчики смогут публиковать задания, а
          исполнители — находить подходящую подработку.
        </p>
        <p role="status">
          {status.isPending
            ? "Проверяем соединение с API…"
            : status.isError
              ? "API сейчас недоступен"
              : `API ${status.data?.service ?? "ShiftHelper"} работает`}
        </p>
      </section>
    </main>
  );
}
