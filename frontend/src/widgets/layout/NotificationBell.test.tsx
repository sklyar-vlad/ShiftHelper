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
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  getGetCurrentUserQueryKey,
  getListMyNotificationsQueryKey,
  type CurrentUser,
  type Notification,
} from "@/shared/api/generated/api";
import { SessionProvider } from "@/shared/model/session";
import { AppLayout } from "./AppLayout";

const sessionKey = getGetCurrentUserQueryKey();
const user: CurrentUser = {
  id: "owner",
  name: "Заказчик",
  role: "customer",
  email: "owner@example.test",
  bio: "",
  completedGigsCount: 0,
  ratingAverage: null,
  reviewsCount: 0,
  createdAt: "2026-11-01T00:00:00Z",
};
const notification: Notification = {
  id: "notification-1",
  type: "application_created",
  gigTitle: "Переезд",
  gigId: "gig-1",
  createdAt: user.createdAt,
  readAt: null,
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const bell = () => screen.getByRole("button", { name: "Уведомления" });
const open = async () => {
  fireEvent.click(bell());
  return screen.findByRole("dialog", { name: "Уведомления" });
};

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(handler: (url: URL, init: RequestInit) => Promise<Response>) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, gcTime: Infinity },
    },
  });
  client.setQueryData(sessionKey, user);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const parsed = new URL(url, "http://localhost");
      if (parsed.pathname === "/api/v1/me")
        return json(client.getQueryData(sessionKey));
      return handler(parsed, init);
    }),
  );
  const router = createMemoryRouter([
    {
      element: <AppLayout />,
      children: [
        { index: true, element: <h1>Главная страница</h1> },
        { path: "gigs/:gigId", element: <h1>Страница задания</h1> },
        { path: "my-gigs", element: <h1>История откликов</h1> },
      ],
    },
  ]);
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { client, router };
}

it("uses the global unread count, loads a cursor page and retries a failed read after navigation", async () => {
  let read = false;
  let readAll = false;
  const mark = vi.fn(() => {
    if (!read) {
      read = true;
      return json({}, 500);
    }
    return new Response(null, { status: 204 });
  });
  let marked = false;
  const { router } = mount(async (url) => {
    if (url.pathname.endsWith("/read")) {
      const response = mark();
      marked = response.ok;
      return response;
    }
    if (url.pathname.endsWith("/read-all")) {
      readAll = true;
      return new Response(null, { status: 204 });
    }
    const second = url.searchParams.get("cursor") === "next";
    return json({
      items: second
        ? [
            {
              ...notification,
              id: "notification-2",
              type: "gig_cancelled",
              gigTitle: "Отмена",
              cancellationReason: "schedule_changed",
              readAt: readAll ? user.createdAt : null,
            },
          ]
        : [
            {
              ...notification,
              readAt: marked || readAll ? user.createdAt : null,
            },
          ],
      nextCursor: second ? null : "next",
      unreadCount: readAll ? 0 : marked ? 6 : 7,
    });
  });
  await within(bell()).findByText("7", { exact: true });
  let dialog = await open();
  fireEvent.click(
    await within(dialog).findByRole("button", { name: "Загрузить ещё" }),
  );
  const cancelled = await within(dialog).findByRole("link", {
    name: /Заказчик отменил задание/,
  });
  expect(cancelled.getAttribute("href")).toBe(
    "/my-gigs?view=applications&scope=history",
  );
  expect(within(cancelled).getByText("Изменились сроки")).toBeTruthy();
  expect(mark).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole("link", { name: /Новый отклик/ }));
  await screen.findByRole("heading", { name: "Страница задания" });
  expect(router.state.location.pathname).toBe("/gigs/gig-1");
  dialog = await open();
  const retry = await within(dialog).findByRole("button", {
    name: "Повторить отметку",
  });
  expect(
    within(dialog).getByRole("link", { name: /Новый отклик.*Не прочитано/ }),
  ).toBeTruthy();
  fireEvent.click(retry);
  await waitFor(() => expect(mark).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      within(dialog)
        .getByRole("link", { name: /Новый отклик/ })
        .getAttribute("data-unread"),
    ).toBe("false"),
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Отметить всё прочитанным" }),
  );
  await waitFor(() =>
    expect(within(dialog).queryByText("Не прочитано")).toBeNull(),
  );
});

it("removes private notifications on account change and ignores a late response", async () => {
  let activeUser = user.id;
  let finish!: (res: Response) => void;
  const load = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const { client } = mount(async (url) => {
    if (url.pathname.endsWith("/logout"))
      return new Response(null, { status: 204 });
    if (activeUser === user.id) return load();
    return json({
      items: [
        {
          ...notification,
          id: "other-notification",
          gigTitle: "Другое задание",
        },
      ],
      nextCursor: null,
      unreadCount: 1,
    });
  });
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  await act(async () => {
    activeUser = "other";
    client.setQueryData(sessionKey, { ...user, id: activeUser });
  });
  await waitFor(() =>
    expect(within(bell()).getByText("1", { exact: true })).toBeTruthy(),
  );
  const dialog = await open();
  await within(dialog).findByText("Другое задание");
  await act(async () =>
    finish(json({ items: [notification], unreadCount: 1, nextCursor: null })),
  );
  expect(within(dialog).queryByText("Переезд")).toBeNull();
  expect(
    client.getQueryState([...getListMyNotificationsQueryKey(), user.id]),
  ).toBeUndefined();
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Выйти" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Уведомления" })).toBeNull(),
  );
  expect(
    client.getQueriesData({ queryKey: getListMyNotificationsQueryKey() }),
  ).toEqual([]);
});

it("can retry a failed feed and shows the empty state", async () => {
  let failed = true;
  mount(async () =>
    failed
      ? json({}, 500)
      : json({ items: [], unreadCount: 0, nextCursor: null }),
  );
  const dialog = await open();
  const retry = await within(dialog).findByRole("button", {
    name: "Повторить",
  });
  failed = false;
  fireEvent.click(retry);
  await within(dialog).findByText("Уведомлений пока нет.");
});

it("polls only while focused and refreshes when the tab becomes visible", async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  const load = vi.fn(async () =>
    json({ items: [], unreadCount: 0, nextCursor: null }),
  );
  mount(load);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(45_000));
  expect(load).toHaveBeenCalledTimes(2);
  focusManager.setFocused(false);
  await act(async () => vi.advanceTimersByTimeAsync(90_000));
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => {
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(load).toHaveBeenCalledTimes(3);
});
