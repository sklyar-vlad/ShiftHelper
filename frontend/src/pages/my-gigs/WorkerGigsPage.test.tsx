import { afterEach, expect, it, vi } from "vitest";
import {
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

const worker: CurrentUser = {
  id: "worker",
  name: "Исполнитель",
  email: "worker@example.test",
  role: "worker",
  bio: "",
  completedGigsCount: 0,
  createdAt: "2026-11-01T10:00:00Z",
};
const gig: Gig = {
  id: "gig-1",
  title: "Перенести коробки",
  city: "Москва",
  startsAt: "2026-11-10T10:00:00Z",
  endsAt: "2026-11-10T12:00:00Z",
  amountKopecks: 123456,
  status: "in_progress",
  customer: { ...worker, id: "owner", name: "Заказчик", role: "customer" },
  selectedWorker: worker,
  pendingApplicationsCount: 0,
  createdAt: worker.createdAt,
  updatedAt: worker.createdAt,
  description: "Помочь с переездом",
  requirements: "",
  address: "Мира, 1",
  myApplication: {
    id: "app-1",
    gigId: "gig-1",
    worker,
    status: "selected",
    comment: "Готов помочь",
    createdAt: worker.createdAt,
    updatedAt: worker.createdAt,
  },
  submittedAt: null,
  completedAt: null,
  cancelledAt: null,
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(
  path: string,
  handler: (url: string, init: RequestInit) => Promise<Response>,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) =>
      url === "/api/v1/me" ? json(worker) : handler(url, init),
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

it("switches worker lists and restores URL filters after opening a gig", async () => {
  const reads: string[] = [];
  const router = mount(
    "/my-gigs?view=applications&scope=active&page=2",
    async (url) => {
      reads.push(url);
      if (url.startsWith("/api/v1/me/applications"))
        return json({
          items: [{ application: gig.myApplication, gig }],
          total: 21,
          page: 2,
          pageSize: 20,
        });
      if (url.startsWith("/api/v1/me/gigs"))
        return json({ items: [gig], total: 1, page: 1, pageSize: 20 });
      return json(gig);
    },
  );
  fireEvent.click(await screen.findByRole("link", { name: gig.title }));
  fireEvent.click(
    await screen.findByRole("link", { name: "← К моим заданиям" }),
  );
  await screen.findByText("Страница 2");
  expect(new URLSearchParams(router.state.location.search).get("view")).toBe(
    "applications",
  );
  fireEvent.click(screen.getByRole("link", { name: "Назначенные работы" }));
  await screen.findByText("Всего заданий: 1");
  expect(new URLSearchParams(router.state.location.search).has("page")).toBe(
    false,
  );
  expect(
    reads.some(
      (url) =>
        url.startsWith("/api/v1/me/gigs?") && url.includes("scope=active"),
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole("link", { name: "История" }));
  await waitFor(() => expect(reads.at(-1)).toContain("scope=history"));
  expect(
    screen.queryByRole("link", { name: "Опубликовать задание" }),
  ).toBeNull();
});

it("submits assigned work once and then shows the confirmation waiting state", async () => {
  let current = gig;
  let finish: (response: Response) => void = () => {};
  const post = vi.fn((url: string) => {
    expect(url).toBe("/api/v1/gigs/gig-1/submit");
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  mount("/gigs/gig-1", async (url, init) =>
    init.method === "POST" ? post(url) : json(current),
  );
  const button = await screen.findByRole("button", {
    name: "Работа выполнена",
  });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect((button as HTMLButtonElement).disabled).toBe(true);
  current = {
    ...gig,
    status: "awaiting_confirmation",
    submittedAt: worker.createdAt,
  };
  finish(json(current));
  await screen.findByText("Работа сдана. Ожидайте подтверждения заказчика.");
  expect(screen.queryByRole("button", { name: "Работа выполнена" })).toBeNull();
});

it("refreshes a stale submission after a conflict", async () => {
  let current = gig;
  mount("/gigs/gig-1", async (_url, init) => {
    if (init.method === "POST") {
      current = { ...gig, status: "awaiting_confirmation" };
      return json(
        { error: { code: "STATE_CONFLICT", message: "Работа уже сдана" } },
        409,
      );
    }
    return json(current);
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Работа выполнена" }),
  );
  await screen.findByText("Работа уже сдана");
  await screen.findByText("Работа сдана. Ожидайте подтверждения заказчика.");
  expect(screen.queryByRole("button", { name: "Работа выполнена" })).toBeNull();
});

it("does not offer submission to a rejected applicant", async () => {
  mount("/gigs/gig-1", async () =>
    json({
      ...gig,
      selectedWorker: { ...worker, id: "other-worker" },
      myApplication: { ...gig.myApplication, status: "rejected" },
    }),
  );
  await screen.findByText("Отклик отклонён.");
  expect(screen.queryByRole("button", { name: "Работа выполнена" })).toBeNull();
});

it("shows completed work in application history", async () => {
  mount("/my-gigs?view=applications&scope=history", async () =>
    json({
      items: [
        {
          application: gig.myApplication,
          gig: { ...gig, status: "completed" },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    }),
  );
  await screen.findByText("Работа завершена.");
  expect(screen.getByText("Завершено")).toBeTruthy();
});

it("retries failed worker lists and handles an empty result", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(
      json({ error: { code: "INTERNAL_ERROR", message: "Ошибка" } }, 500),
    )
    .mockResolvedValueOnce(
      json({ items: [], total: 0, page: 1, pageSize: 20 }),
    );
  mount("/my-gigs", read);
  fireEvent.click(
    await screen.findByRole("button", { name: "Попробовать ещё раз" }),
  );
  await screen.findByText("Откликов пока нет");
  expect(read).toHaveBeenCalledTimes(2);
});
