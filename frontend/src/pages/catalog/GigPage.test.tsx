import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { SessionProvider } from "@/shared/model/session";
import {
  getGetCurrentUserQueryKey,
  getGetGigQueryKey,
  type CurrentUser,
  type Gig,
} from "@/shared/api/generated/api";
import { GigPage } from "./GigPage";

const worker: CurrentUser = {
  id: "worker",
  name: "Исполнитель",
  bio: "",
  role: "worker",
  completedGigsCount: 0,
  ratingAverage: null,
  reviewsCount: 0,
  email: "private@example.test",
  createdAt: "2026-11-01T10:00:00Z",
};
const gig: Gig = {
  id: "gig-1",
  title: "Помощь",
  city: "Москва",
  startsAt: "2026-11-10T10:00:00Z",
  endsAt: "2026-11-10T12:00:00Z",
  amountKopecks: 10000,
  status: "open",
  customer: { ...worker, id: "customer", role: "customer", name: "Заказчик" },
  selectedWorker: null,
  pendingApplicationsCount: 0,
  createdAt: worker.createdAt,
  updatedAt: worker.createdAt,
  description: "Перенести коробки",
  requirements: "",
  address: "Мира, 1",
  myApplication: null,
  submittedAt: null,
  completedAt: null,
  cancelledAt: null,
};
const application = {
  id: "app-1",
  gigId: gig.id,
  worker,
  status: "pending" as const,
  comment: "Готов помочь",
  createdAt: worker.createdAt,
  updatedAt: worker.createdAt,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(
  handler: (url: string, init: RequestInit) => Promise<Response>,
  user: CurrentUser | null = worker,
  initialEntry = "/gigs/gig-1",
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) =>
      url === "/api/v1/gig-categories"
        ? json([
            { code: "other", name: "Другое" },
            { code: "repair", name: "Ремонт и сборка" },
            { code: "moving", name: "Переезды и погрузка" },
          ])
        : url === "/api/v1/me"
          ? user
            ? json(user)
            : json({ error: { code: "UNAUTHORIZED", message: "Войдите" } }, 401)
          : handler(url, init),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [{ path: "/gigs/:gigId", element: <GigPage /> }],
    { initialEntries: [initialEntry] },
  );
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { client, router };
}

it("keeps the terms draft through a temporary refetch failure and hides it when access is lost", async () => {
  let status = 200;
  const { client } = mount(
    async (url) =>
      url.includes("/applications?")
        ? json({ items: [], page: 1, pageSize: 20, total: 0 })
        : json(gig, status),
    { ...worker, role: "customer", id: gig.customer.id },
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Изменить условия" }),
  );
  const title = screen.getByLabelText<HTMLInputElement>("Название");
  fireEvent.change(title, { target: { value: "Черновик условий" } });

  const refetch = () =>
    act(async () =>
      client.invalidateQueries({ queryKey: getGetGigQueryKey(gig.id) }),
    );
  status = 500;
  await refetch();
  expect(screen.getByLabelText<HTMLInputElement>("Название").value).toBe(
    "Черновик условий",
  );

  status = 404;
  await refetch();
  await screen.findByRole("heading", { name: "Задание недоступно" });
  expect(screen.queryByLabelText("Название")).toBeNull();
});

const copyButton = { name: "Скопировать ссылку" };
const copySuccess = "Ссылка скопирована";
const copyError =
  "Не удалось скопировать ссылку. Скопируйте адрес из строки браузера";

it("copies the canonical link once and confirms only after the write", async () => {
  let finish!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  mount(async () => json(gig), worker, "/gigs/gig-1?city=Moscow#address");
  const button = (await screen.findByRole(
    "button",
    copyButton,
  )) as HTMLButtonElement;

  fireEvent.click(button);
  fireEvent.click(button);

  expect(writeText).toHaveBeenCalledExactlyOnceWith(
    `${window.location.origin}/gigs/${gig.id}`,
  );
  expect(button.disabled).toBe(true);
  expect(screen.queryByText(copySuccess)).toBeNull();

  finish();
  await screen.findByText(copySuccess);
  expect(button.disabled).toBe(false);

  fireEvent.click(button);
  expect(screen.queryByText(copySuccess)).toBeNull();
  await act(async () => finish());
});

it.each([undefined, { writeText: () => Promise.reject(new Error("Denied")) }])(
  "offers manual copying when clipboard writing is unavailable (%s)",
  async (clipboard) => {
    vi.stubGlobal("navigator", { clipboard });
    mount(async () => json(gig));
    fireEvent.click(await screen.findByRole("button", copyButton));
    await screen.findByText(copyError);
    expect(screen.queryByText(copySuccess)).toBeNull();
  },
);

it("ignores an earlier write after navigating away and back", async () => {
  const writes: Array<() => void> = [];
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        writes.push(resolve);
      }),
  );
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const { router } = mount(async (url) =>
    json(
      url.endsWith("/gig-2")
        ? { ...gig, id: "gig-2", title: "Другое задание" }
        : gig,
    ),
  );

  fireEvent.click(await screen.findByRole("button", copyButton));
  await act(async () => router.navigate("/gigs/gig-2"));
  await screen.findByRole("heading", { name: "Другое задание" });
  await act(async () => router.navigate("/gigs/gig-1"));
  const button = (await screen.findByRole(
    "button",
    copyButton,
  )) as HTMLButtonElement;
  fireEvent.click(button);

  await act(async () => writes[0]());
  expect(button.disabled).toBe(true);
  expect(screen.queryByText(copySuccess)).toBeNull();

  await act(async () => writes[1]());
  await screen.findByText(copySuccess);
});

it("offers login to guests and no application form to customers", async () => {
  mount(async () => json(gig), null);
  expect(
    (await screen.findByRole("link", { name: "Войти" })).getAttribute("href"),
  ).toBe("/login");
  expect(screen.queryByRole("form")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Пожаловаться/ })).toBeNull();
  cleanup();
  mount(
    async (url) =>
      json(
        url.includes("/applications?")
          ? { items: [], page: 1, pageSize: 20, total: 0 }
          : gig,
      ),
    { ...worker, role: "customer", id: "customer" },
  );
  await screen.findByText("Это ваше задание.");
  expect(screen.queryByRole("form")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Пожаловаться/ })).toBeNull();
});

it("creates and withdraws an application, blocking duplicate sends and reapplication", async () => {
  let current = gig;
  let finish: (response: Response) => void = () => {};
  const post = vi.fn((url: string, init: RequestInit) => {
    if (url.endsWith("/withdraw")) {
      current = {
        ...gig,
        myApplication: { ...application, status: "withdrawn" },
      };
      return Promise.resolve(json(current.myApplication));
    }
    expect(JSON.parse(init.body as string)).toEqual({
      comment: "Готов помочь",
      termsVersion: 1,
    });
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  mount(async (url, init) =>
    init.method === "POST" ? post(url, init) : json(current),
  );
  fireEvent.change(
    await screen.findByLabelText("Комментарий (необязательно)"),
    { target: { value: "  Готов помочь  " } },
  );
  const form = screen.getByRole("form", { name: "Отклик на задание" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(
    (screen.getByRole("button", { name: "Отправляем…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  current = { ...gig, myApplication: application };
  finish(json(application));
  await screen.findByText("Отклик ожидает решения заказчика.");
  fireEvent.click(screen.getByRole("button", { name: "Отозвать отклик" }));
  await screen.findByText("Отклик отозван. Повторно откликнуться нельзя.");
  expect(post).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("form")).toBeNull();
});

it("refreshes after a conflict and removes actions for a cancelled gig", async () => {
  let current: Gig = { ...gig, myApplication: application };
  mount(async (_url, init) => {
    if (init.method !== "POST") return json(current);
    current = {
      ...gig,
      status: "cancelled",
      myApplication: { ...application, status: "rejected" },
    };
    return json(
      { error: { code: "STATE_CONFLICT", message: "Задание уже отменено" } },
      409,
    );
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Отозвать отклик" }),
  );
  await screen.findByText("Задание уже отменено");
  await screen.findByText("Отклик отклонён.");
  expect(screen.getByText("Отменено")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Отозвать отклик" })).toBeNull();
});

it("shows the selected worker without allowing withdrawal", async () => {
  mount(async () =>
    json({
      ...gig,
      status: "in_progress",
      selectedWorker: worker,
      myApplication: { ...application, status: "selected" },
    }),
  );
  await screen.findByText("Вы выбраны исполнителем.");
  expect(
    screen.getByRole("heading", { name: "Выбранный исполнитель" }),
  ).toBeTruthy();
  expect(screen.getByText("В работе")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Отозвать отклик" })).toBeNull();
  expect(screen.queryByText(worker.email)).toBeNull();
  expect(
    screen.getAllByRole("button", { name: "Пожаловаться на пользователя" }),
  ).toHaveLength(1);
});

it("hides the private application after logout", async () => {
  const { client } = mount(async () =>
    json({ ...gig, myApplication: application }),
  );
  await screen.findByText(application.comment);
  await act(async () => {
    client.setQueryData(getGetCurrentUserQueryKey(), null);
  });
  await screen.findByRole("link", { name: "Войти" });
  expect(screen.queryByText(application.comment)).toBeNull();
});

it("offers reviews only to the two participants of a completed gig", async () => {
  const completed: Gig = {
    ...gig,
    status: "completed",
    selectedWorker: worker,
  };
  for (const [current, user, allowed] of [
    [completed, worker, true],
    [completed, { ...worker, id: "customer", role: "customer" }, true],
    [completed, { ...worker, id: "rejected" }, false],
    [completed, null, false],
    [{ ...completed, status: "awaiting_confirmation" }, worker, false],
  ] as const) {
    const reviews = vi.fn();
    mount(async (url) => {
      if (url.endsWith("/reviews")) {
        reviews();
        return json({ items: [] });
      }
      return json(current);
    }, user);
    await screen.findByRole("heading", { name: gig.title });
    if (allowed) {
      await screen.findByRole("form", { name: "Оценить вторую сторону" });
      expect(reviews).toHaveBeenCalledTimes(1);
    } else {
      expect(
        screen.queryByRole("form", { name: "Оценить вторую сторону" }),
      ).toBeNull();
      expect(reviews).not.toHaveBeenCalled();
    }
    cleanup();
  }
});

it.each(["<b>@private-contact</b>", ""])(
  "shows counterpart contact safely as text: %s",
  async (contact) => {
    mount(async () =>
      json({
        ...gig,
        status: "in_progress",
        selectedWorker: worker,
        counterpartyContact: contact,
      }),
    );
    await screen.findByRole("heading", { name: "Контакт заказчика" });
    expect(
      screen.getByText(
        contact ||
          "Контакт пока не указан. Вторая сторона может добавить его в своём профиле.",
      ),
    ).toBeTruthy();
    expect(document.querySelector("b")).toBeNull();
  },
);

it("does not keep a private contact when the account changes", async () => {
  const { client } = mount(async () =>
    json({
      ...gig,
      counterpartyContact:
        client.getQueryData<CurrentUser>(getGetCurrentUserQueryKey())?.id ===
        worker.id
          ? "@private-contact"
          : undefined,
    }),
  );
  await screen.findByText("@private-contact");
  await act(async () => {
    client.setQueryData(getGetCurrentUserQueryKey(), {
      ...worker,
      id: "different-account",
    });
  });
  await waitFor(() =>
    expect(screen.queryByText("@private-contact")).toBeNull(),
  );
});

it("confirms the exact revised conditions of an existing application", async () => {
  let current = {
    ...gig,
    termsVersion: 2,
    myApplication: { ...application, termsVersion: 1 },
  };
  const send = vi.fn(async (_url: string, init: RequestInit) => {
    expect(JSON.parse(init.body as string)).toEqual({ termsVersion: 2 });
    current = {
      ...current,
      myApplication: { ...current.myApplication, termsVersion: 2 },
    };
    return json(current);
  });
  mount(async (url, init) =>
    init.method === "POST" ? send(url, init) : json(current),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Подтвердить новые условия" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Подтвердить новые условия" }),
    ).toBeNull(),
  );
  expect(send).toHaveBeenCalledTimes(1);
});

it("shows a real comparison and sends the immutable proposal ID", async () => {
  const current: Gig = {
    ...gig,
    category: "repair",
    point: { latitude: 0, longitude: 0 },
    status: "in_progress",
    selectedWorker: worker,
    termsVersion: 1,
    hasPendingChange: true,
    pendingChange: {
      id: "proposal-1",
      termsVersion: 1,
      terms: {
        category: "moving",
        point: {
          latitude: 55.75,
          longitude: 37.62,
          source: "geoapify",
          attribution: "OpenStreetMap contributors",
        },
        title: "Новые условия",
        description: "Другое описание",
        requirements: "",
        city: "Киров, Калужская область",
        address: "Мира, 2",
        startsAt: gig.startsAt,
        endsAt: gig.endsAt,
        amountKopecks: 200099,
      },
    },
  };
  let resolved = false;
  const send = vi.fn(async (url: string) => {
    expect(url).toBe("/api/v1/gigs/gig-1/changes/proposal-1/accept");
    resolved = true;
    return json({ ...current, pendingChange: undefined });
  });
  mount(async (url, init) =>
    init.method === "POST"
      ? send(url)
      : json({
          ...current,
          pendingChange: resolved ? undefined : current.pendingChange,
        }),
  );
  await screen.findByRole("heading", { name: "Предложены новые условия" });
  expect(screen.getByText("Новые условия")).toBeTruthy();
  expect(screen.getByText("0.000000, 0.000000")).toBeTruthy();
  expect(screen.getByText("55.750000, 37.620000")).toBeTruthy();
  expect(screen.getByText(/OpenStreetMap contributors/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Geoapify" })).toBeTruthy();
  await screen.findByText("Переезды и погрузка");
  expect(screen.getAllByText("Ремонт и сборка").length).toBeGreaterThanOrEqual(
    2,
  );
  fireEvent.click(screen.getByRole("button", { name: "Согласиться" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Согласиться" })).toBeNull(),
  );
});

const gigReport = "Пожаловаться на задание";
const userReport = "Пожаловаться на пользователя";
const demoResult = "Демо: жалоба не отправлена и не сохранена.";

async function openReport(name: string) {
  fireEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("dialog", { name });
}

it("validates the reason and Unicode limit and completes a gig report without a request", async () => {
  mount(async () => json(gig));
  const dialog = await openReport(gigReport);
  const report = within(dialog);
  expect(report.getByText(`Задание — ${gig.title}`)).toBeTruthy();
  expect(
    report.getByText("Демо-режим: жалобы пока не отправляются модераторам."),
  ).toBeTruthy();
  const form = report.getByRole<HTMLFormElement>("form");
  const reason = report.getByLabelText<HTMLSelectElement>("Причина");
  const comment = report.getByLabelText<HTMLTextAreaElement>(
    "Комментарий к жалобе (необязательно)",
  );
  expect(form.checkValidity()).toBe(false);
  const fetch = vi.mocked(globalThis.fetch);
  const requestsBefore = fetch.mock.calls.length;
  fireEvent.submit(form);
  expect(report.queryByText(demoResult)).toBeNull();

  fireEvent.change(reason, { target: { value: "spam" } });
  const limit = "😀".repeat(1000);
  fireEvent.change(comment, { target: { value: limit + "😀" } });
  fireEvent.submit(form);
  expect(
    report.getByText("Сократите комментарий до 1000 символов."),
  ).toBeTruthy();
  expect(report.queryByText(demoResult)).toBeNull();

  fireEvent.change(comment, { target: { value: limit } });
  fireEvent.submit(form);
  expect(report.getByRole("status").textContent).toBe(demoResult);
  expect(fetch).toHaveBeenCalledTimes(requestsBefore);
  fireEvent.click(report.getByRole("button", { name: "Закрыть" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("targets the displayed user and clears the draft on cancellation", async () => {
  mount(async () => json(gig));
  const report = within(await openReport(userReport));
  expect(report.getByText(`Пользователь — ${gig.customer.name}`)).toBeTruthy();
  fireEvent.change(report.getByLabelText("Причина"), {
    target: { value: "fraud" },
  });
  fireEvent.change(
    report.getByLabelText("Комментарий к жалобе (необязательно)"),
    {
      target: { value: "Черновик" },
    },
  );
  fireEvent.click(report.getByRole("button", { name: "Отмена" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const reopened = within(await openReport(userReport));
  expect(reopened.getByLabelText<HTMLSelectElement>("Причина").value).toBe("");
  expect(
    reopened.getByLabelText<HTMLTextAreaElement>(
      "Комментарий к жалобе (необязательно)",
    ).value,
  ).toBe("");
  fireEvent.change(reopened.getByLabelText("Причина"), {
    target: { value: "other" },
  });
  fireEvent.submit(reopened.getByRole("form"));
  expect(reopened.getByRole("status").textContent).toBe(demoResult);
});

it("closes and clears the report when the signed-in account changes", async () => {
  const { client } = mount(async () => json(gig));
  const report = within(await openReport(userReport));
  fireEvent.change(report.getByLabelText("Причина"), {
    target: { value: "incorrect" },
  });
  fireEvent.change(
    report.getByLabelText("Комментарий к жалобе (необязательно)"),
    {
      target: { value: "Старый аккаунт" },
    },
  );
  await act(async () => {
    client.setQueryData(getGetCurrentUserQueryKey(), {
      ...worker,
      id: "another-worker",
    });
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const reopened = within(await openReport(userReport));
  expect(reopened.getByLabelText<HTMLSelectElement>("Причина").value).toBe("");
  expect(
    reopened.getByLabelText<HTMLTextAreaElement>(
      "Комментарий к жалобе (необязательно)",
    ).value,
  ).toBe("");
});

it("closes a draft on navigation and opens a clean report for the new gig", async () => {
  const next = { ...gig, id: "gig-2", title: "Другое задание" };
  const { router } = mount(async (url) =>
    json(url.endsWith(next.id) ? next : gig),
  );
  const report = within(await openReport(gigReport));
  fireEvent.change(report.getByLabelText("Причина"), {
    target: { value: "other" },
  });
  fireEvent.change(
    report.getByLabelText("Комментарий к жалобе (необязательно)"),
    {
      target: { value: "Для первого задания" },
    },
  );
  await act(async () => {
    await router.navigate(`/gigs/${next.id}`);
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  const reopened = within(await openReport(gigReport));
  expect(reopened.getByText(`Задание — ${next.title}`)).toBeTruthy();
  expect(reopened.getByLabelText<HTMLSelectElement>("Причина").value).toBe("");
  expect(
    reopened.getByLabelText<HTMLTextAreaElement>(
      "Комментарий к жалобе (необязательно)",
    ).value,
  ).toBe("");
});
