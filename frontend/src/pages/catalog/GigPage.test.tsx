import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { SessionProvider } from "@/shared/model/session";
import {
  getGetCurrentUserQueryKey,
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
    { initialEntries: ["/gigs/gig-1"] },
  );
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return client;
}

it("offers login to guests and no application form to customers", async () => {
  mount(async () => json(gig), null);
  expect(
    (await screen.findByRole("link", { name: "Войти" })).getAttribute("href"),
  ).toBe("/login");
  expect(screen.queryByRole("form")).toBeNull();
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
});

it("hides the private application after logout", async () => {
  const client = mount(async () =>
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
  const client = mount(async () =>
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
    status: "in_progress",
    selectedWorker: worker,
    termsVersion: 1,
    hasPendingChange: true,
    pendingChange: {
      id: "proposal-1",
      termsVersion: 1,
      terms: {
        category: "moving",
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
