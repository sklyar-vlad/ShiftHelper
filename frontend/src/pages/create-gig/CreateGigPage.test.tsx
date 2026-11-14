import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { SessionProvider } from "@/shared/model/session";
import { RequireUser } from "@/shared/ui/RequireUser";
import { CreateGigPage, parseRubles } from "./CreateGigPage";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const categoryList = [
  { code: "other", name: "Другое" },
  { code: "moving", name: "Переезды и погрузка" },
  { code: "repair", name: "Ремонт и сборка" },
];
const localDate = (offset: number) => {
  const d = new Date(Date.now() + offset);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mount(
  role = "customer",
  send = vi.fn<(init: RequestInit) => Promise<Response>>(async () =>
    json({ id: "new-gig" }, 201),
  ),
  categoryResponse?: () => Promise<Response>,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) =>
      url === "/api/v1/gig-categories"
        ? categoryResponse
          ? categoryResponse()
          : json(categoryList)
        : url === "/api/v1/me"
          ? json({ id: "user", name: "Тест", role })
          : send(init),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <MemoryRouter initialEntries={["/gigs/new"]}>
          <Routes>
            <Route element={<RequireUser role="customer" />}>
              <Route path="/gigs/new" element={<CreateGigPage />} />
            </Route>
            <Route path="/gigs/:id" element={<h1>Опубликовано</h1>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
  if (role === "customer") {
    await screen.findByLabelText("Название");
    if (!categoryResponse)
      await screen.findByRole("option", { name: "Другое" });
  }
  return send;
}

function fill() {
  for (const [label, value] of Object.entries({
    Название: "  Помочь с переездом  ",
    Описание: "Перенести коробки",
    Город: "Москва",
    Адрес: "Мира, 1",
    "Начало работы": localDate(86400000),
    "Окончание работы": localDate(90000000),
    "Сумма за всё задание, ₽": "0,29",
  })) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}
const submit = () =>
  fireEvent.submit(screen.getByRole("form", { name: "Новое задание" }));

it("converts decimal rubles to exact integer kopecks and rejects invalid amounts", () => {
  for (const [value, expected] of [
    ["0,29", 29],
    ["0.01", 1],
    ["12.3", 1230],
    ["100000000", 10000000000],
    ["0", null],
    ["100000000.01", null],
    ["1.001", null],
    ["1e3", null],
    ["-1", null],
    ["", null],
  ] as const)
    expect(parseRubles(value)).toBe(expected);
});

it("publishes exact money and timezone dates, then opens the new gig", async () => {
  const send = await mount();
  fill();
  fireEvent.change(screen.getByLabelText("Категория"), {
    target: { value: "moving" },
  });
  submit();
  await screen.findByRole("heading", { name: "Опубликовано" });
  const input = JSON.parse(send.mock.calls[0][0].body as string);
  expect(input.amountKopecks).toBe(29);
  expect(input.category).toBe("moving");
  expect(input.title).toBe("Помочь с переездом");
  expect(input.requirements).toBe("");
  expect(input.startsAt.endsWith("Z")).toBe(true);
  expect(new Date(input.endsAt).getTime()).toBeGreaterThan(
    new Date(input.startsAt).getTime(),
  );
});

it("rejects past start and end before start without sending", async () => {
  const send = await mount();
  fill();
  fireEvent.change(screen.getByLabelText("Начало работы"), {
    target: { value: localDate(-86400000) },
  });
  submit();
  await screen.findByText("Начало должно быть в будущем.");
  fireEvent.change(screen.getByLabelText("Начало работы"), {
    target: { value: localDate(100000000) },
  });
  submit();
  await screen.findByText("Окончание должно быть позже начала.");
  expect(send).not.toHaveBeenCalled();
});

it("blocks duplicate sends and maps API errors to fields without losing values", async () => {
  let finish: (response: Response) => void = () => {};
  const send = vi.fn<(init: RequestInit) => Promise<Response>>(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  await mount("customer", send);
  fill();
  submit();
  submit();
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(
    (screen.getByRole("button", { name: "Публикуем…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  finish(
    json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Проверьте поля",
          fields: { amountKopecks: ["Проверьте сумму"] },
        },
      },
      400,
    ),
  );
  await screen.findByText("Проверьте сумму");
  expect((screen.getByLabelText("Город") as HTMLInputElement).value).toBe(
    "Москва",
  );
});

it("denies the publication form to workers", async () => {
  const send = await mount("worker");
  await screen.findByRole("heading", { name: "Этот раздел для заказчиков" });
  expect(screen.queryByRole("form")).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

it("keeps publication fields after a proxy failure and retries only on submit", async () => {
  const send = vi
    .fn<(init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(
      new Response("<h1>proxy failed</h1>", { status: 502 }),
    )
    .mockResolvedValueOnce(json({ id: "new-gig" }, 201));
  await mount("customer", send);
  fill();
  submit();
  await screen.findByRole("alert");
  expect((screen.getByLabelText("Город") as HTMLInputElement).value).toBe(
    "Москва",
  );
  expect((screen.getByLabelText("Описание") as HTMLTextAreaElement).value).toBe(
    "Перенести коробки",
  );
  expect(screen.queryByText(/proxy failed/)).toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    (screen.getByRole("button", { name: "Опубликовать" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  submit();
  await screen.findByRole("heading", { name: "Опубликовано" });
  expect(send).toHaveBeenCalledTimes(2);
});

it("edits existing terms without losing past dates, cents or legacy cities", async () => {
  const { GigForm } = await import("./CreateGigPage");
  const client = new QueryClient();
  client.setQueryData(["/api/v1/me"], { id: "customer" });
  const saved = vi.fn();
  const send = vi.fn(async (_url: string, init: RequestInit) => {
    const input = JSON.parse(init.body as string);
    expect(input.termsVersion).toBe(2);
    expect(input.category).toBe("repair");
    expect(input.startsAt).toBe("2026-01-01T09:00:00.123456Z");
    expect(input.amountKopecks).toBe(150050);
    expect(input.city).toBe("Старый свободный ввод");
    return json(input);
  });
  vi.stubGlobal("fetch", (url: string, init: RequestInit) =>
    url === "/api/v1/gig-categories"
      ? Promise.resolve(json(categoryList))
      : send(url, init),
  );
  const gig = {
    id: "gig-1",
    category: "repair" as const,
    title: "Задание",
    description: "Описание",
    requirements: "",
    city: "Старый свободный ввод",
    address: "Адрес",
    startsAt: "2026-01-01T09:00:00.123456Z",
    endsAt: "2026-01-01T12:00:00Z",
    amountKopecks: 150050,
    termsVersion: 2,
    status: "in_progress" as const,
    customer: {
      id: "customer",
      name: "Customer",
      bio: "",
      role: "customer" as const,
      ratingAverage: null,
      reviewsCount: 0,
      completedGigsCount: 0,
    },
    selectedWorker: null,
    pendingApplicationsCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    submittedAt: null,
    completedAt: null,
    cancelledAt: null,
    myApplication: null,
  };
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GigForm gig={gig} onSaved={saved} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("option", { name: "Другое" });
  expect((screen.getByLabelText("Категория") as HTMLSelectElement).value).toBe(
    "repair",
  );
  fireEvent.change(screen.getByLabelText("Описание"), {
    target: { value: "Новая версия описания" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Предложить изменения" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(send).toHaveBeenCalledTimes(1);
});

it("keeps draft and blocks submission until the category dictionary loads", async () => {
  let finish: (response: Response) => void = () => {};
  const send = vi.fn<(init: RequestInit) => Promise<Response>>(async () =>
    json({ id: "new-gig" }, 201),
  );
  await mount(
    "customer",
    send,
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  fill();
  expect(
    (screen.getByLabelText("Категория") as HTMLSelectElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Опубликовать" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(send).not.toHaveBeenCalled();
  finish(json(categoryList));
  await screen.findByRole("option", { name: "Другое" });
  expect((screen.getByLabelText("Категория") as HTMLSelectElement).value).toBe(
    "other",
  );
  expect((screen.getByLabelText("Описание") as HTMLTextAreaElement).value).toBe(
    "Перенести коробки",
  );
});

it("retries dictionary failures without losing input or inventing a category", async () => {
  const send = vi.fn<(init: RequestInit) => Promise<Response>>(async () =>
    json({ id: "new-gig" }, 201),
  );
  const dictionary = vi
    .fn()
    .mockResolvedValueOnce(json({}, 500))
    .mockResolvedValueOnce(json(categoryList));
  await mount("customer", send, dictionary);
  fill();
  await screen.findByRole("button", { name: "Загрузить категории снова" });
  expect(
    (screen.getByRole("button", { name: "Опубликовать" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Загрузить категории снова" }),
  );
  await screen.findByRole("option", { name: "Ремонт и сборка" });
  fireEvent.change(screen.getByLabelText("Категория"), {
    target: { value: "repair" },
  });
  submit();
  await screen.findByRole("heading", { name: "Опубликовано" });
  const input = JSON.parse(send.mock.calls[0][0]?.body as string);
  expect(input.category).toBe("repair");
  expect(input.description).toBe("Перенести коробки");
});

it("keeps the chosen category after a failed publication", async () => {
  const send = vi.fn<(init: RequestInit) => Promise<Response>>(async () =>
    json({}, 500),
  );
  await mount("customer", send);
  fill();
  fireEvent.change(screen.getByLabelText("Категория"), {
    target: { value: "moving" },
  });
  submit();
  await screen.findByRole("alert");
  expect((screen.getByLabelText("Категория") as HTMLSelectElement).value).toBe(
    "moving",
  );
});
