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
import type { CurrentUser, Gig } from "@/shared/api/generated/api";
import { GigPage } from "@/pages/catalog/GigPage";
import { MyGigsPage } from "./MyGigsPage";

const owner: CurrentUser = {
  id: "owner",
  name: "Заказчик",
  email: "owner@example.test",
  role: "customer",
  bio: "",
  completedGigsCount: 0,
  ratingAverage: null,
  reviewsCount: 0,
  createdAt: "2026-11-01T10:00:00Z",
};
const worker = {
  id: "worker",
  name: "Исполнитель",
  role: "worker" as const,
  bio: "Помогаю по городу",
  completedGigsCount: 2,
  ratingAverage: null,
  reviewsCount: 0,
};
const gig: Gig = {
  id: "gig-1",
  title: "Помочь с переездом",
  city: "Москва",
  startsAt: "2026-11-10T10:00:00Z",
  endsAt: "2026-11-10T12:00:00Z",
  amountKopecks: 10000,
  status: "open",
  customer: owner,
  selectedWorker: null,
  pendingApplicationsCount: 1,
  createdAt: owner.createdAt,
  updatedAt: owner.createdAt,
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
  comment: "Готов завтра",
  status: "pending",
  createdAt: owner.createdAt,
  updatedAt: owner.createdAt,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(
  path: string,
  handler: (url: string, init: RequestInit) => Promise<Response>,
  user = owner,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) =>
      url === "/api/v1/gig-categories"
        ? json([{ code: "other", name: "Другое" }])
        : url === "/api/v1/me"
          ? json(user)
          : handler(url, init),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [
      { path: "/my-gigs", element: <MyGigsPage /> },
      { path: "/gigs/:gigId", element: <GigPage /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return router;
}

it("restores dashboard filters and pagination on return from a gig", async () => {
  const requests: URLSearchParams[] = [];
  const router = mount("/my-gigs?scope=history&page=2", async (url) => {
    if (url.startsWith("/api/v1/me/gigs")) {
      const params = new URL(url, "http://localhost").searchParams;
      requests.push(params);
      return json({
        items: [{ ...gig, status: "completed", selectedWorker: worker }],
        total: 21,
        page: Number(params.get("page")),
        pageSize: 20,
      });
    }
    return json({ ...gig, status: "completed", selectedWorker: worker });
  });
  fireEvent.click(await screen.findByRole("link", { name: gig.title }));
  fireEvent.click(
    await screen.findByRole("link", { name: "← К моим заданиям" }),
  );
  await screen.findByText("Страница 2");
  expect(new URLSearchParams(router.state.location.search).get("scope")).toBe(
    "history",
  );
  fireEvent.click(screen.getByRole("link", { name: "Активные" }));
  await waitFor(() => expect(requests.at(-1)?.get("scope")).toBe("active"));
  expect(requests.at(-1)?.get("page")).toBe("1");
  await act(() => router.navigate(-1));
  await screen.findByText("Страница 2");
});

it("requires explicit selection confirmation and blocks duplicate requests", async () => {
  let current = gig;
  let finish: (response: Response) => void = () => {};
  const post = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  mount("/gigs/gig-1", async (url, init) =>
    init.method === "POST"
      ? post()
      : json(
          url.includes("/applications?")
            ? { items: [application], total: 1, page: 1, pageSize: 20 }
            : current,
        ),
  );
  const confirm = vi.fn().mockReturnValue(false);
  vi.stubGlobal("confirm", confirm);
  fireEvent.click(
    await screen.findByRole("button", { name: "Выбрать исполнителя" }),
  );
  expect(post).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  const button = screen.getByRole("button", { name: "Выбрать исполнителя" });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect((button as HTMLButtonElement).disabled).toBe(true);
  current = {
    ...gig,
    status: "in_progress",
    selectedWorker: worker,
    pendingApplicationsCount: 0,
  };
  finish(json(current));
  await screen.findByText("В работе");
  expect(
    screen.queryByRole("button", { name: "Выбрать исполнителя" }),
  ).toBeNull();
  expect(
    screen.getByRole("heading", { name: "Выбранный исполнитель" }),
  ).toBeTruthy();
});

it.each([
  ["open", "Отменить задание", "/cancel", "cancelled", "Отменено"],
  [
    "awaiting_confirmation",
    "Подтвердить выполнение",
    "/confirm",
    "completed",
    "Завершено",
  ],
] as const)(
  "handles the owner action for %s",
  async (initial, label, endpoint, final, status) => {
    let current = { ...gig, status: initial } as Gig;
    const post = vi.fn(async (url: string) => {
      expect(url.endsWith(endpoint)).toBe(true);
      current = { ...current, status: final };
      return json(current);
    });
    mount("/gigs/gig-1", async (url, init) =>
      init.method === "POST"
        ? post(url)
        : json(
            url.includes("/applications?")
              ? { items: [], total: 0, page: 1, pageSize: 20 }
              : current,
          ),
    );
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    fireEvent.click(await screen.findByRole("button", { name: label }));
    await screen.findByText(status);
    expect(post).toHaveBeenCalledTimes(1);
  },
);

it("refreshes a stale gig after a selection conflict", async () => {
  let current = gig;
  mount("/gigs/gig-1", async (url, init) => {
    if (init.method === "POST") {
      current = { ...gig, status: "in_progress", selectedWorker: worker };
      return json(
        {
          error: { code: "STATE_CONFLICT", message: "Исполнитель уже выбран" },
        },
        409,
      );
    }
    return json(
      url.includes("/applications?")
        ? { items: [application], total: 1, page: 1, pageSize: 20 }
        : current,
    );
  });
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  fireEvent.click(
    await screen.findByRole("button", { name: "Выбрать исполнителя" }),
  );
  await screen.findByText("Исполнитель уже выбран");
  await screen.findByText("В работе");
  expect(screen.queryByRole("button", { name: "Отменить задание" })).toBeNull();
});

it("never requests another customer's applications", async () => {
  const read = vi.fn(async () => json(gig));
  mount("/gigs/gig-1", read, { ...owner, id: "other-owner" });
  await screen.findByText("Отклик доступен только исполнителям.");
  expect(read).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("heading", { name: "Ожидающие отклики" }),
  ).toBeNull();
});
