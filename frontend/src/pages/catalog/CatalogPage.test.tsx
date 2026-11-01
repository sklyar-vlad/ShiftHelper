import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { CatalogPage } from "./CatalogPage";
import { GigPage } from "./GigPage";
import { SessionProvider } from "@/shared/model/session";

const gig = {
  id: "gig-1",
  title: "Помощь с переездом",
  city: "Москва",
  startsAt: "2026-11-10T10:00:00+03:00",
  endsAt: "2026-11-10T14:00:00+03:00",
  amountKopecks: 123456,
  status: "open",
  customer: { name: "Алексей" },
  description: "Перенести коробки",
  requirements: "Перчатки",
  address: "Улица Мира, 1",
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

function mount(url = "/catalog", withSession = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [
      { path: "/catalog", element: <CatalogPage /> },
      { path: "/gigs/:gigId", element: <GigPage /> },
    ],
    { initialEntries: [url] },
  );
  render(
    <QueryClientProvider client={client}>
      {withSession ? (
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      ) : (
        <RouterProvider router={router} />
      )}
    </QueryClientProvider>,
  );
  return router;
}

it("finishes the initial public catalog request when the session resolves as guest", async () => {
  let finish: (response: Response) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/v1/me")
        return json(
          { error: { code: "UNAUTHORIZED", message: "Войдите" } },
          401,
        );
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }),
  );
  mount("/catalog", true);
  await screen.findByRole("heading", { name: "Загружаем подработки" });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  finish(json({ items: [gig], page: 1, pageSize: 20, total: 1 }));
  await screen.findByRole("link", { name: gig.title });
});

it("combines URL filters, resets the page on search and restores it on browser back", async () => {
  const requests: URLSearchParams[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const params = new URL(url, "http://localhost").searchParams;
      requests.push(params);
      return json({
        items: [gig],
        page: Number(params.get("page")),
        pageSize: 20,
        total: 45,
      });
    }),
  );
  const router = mount("/catalog?q=переезд&city=Москва&page=2");
  await screen.findByRole("link", { name: gig.title });
  expect(requests[0].get("q")).toBe("переезд");
  expect(requests[0].get("city")).toBe("Москва");
  expect(requests[0].get("page")).toBe("2");
  fireEvent.change(screen.getByLabelText("Название задания"), {
    target: { value: "  коробки  " },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск подработок" }));
  await waitFor(() => expect(requests.at(-1)?.get("q")).toBe("коробки"));
  expect(requests.at(-1)?.get("city")).toBe("Москва");
  expect(requests.at(-1)?.get("page")).toBe("1");
  expect(new URLSearchParams(router.state.location.search).has("page")).toBe(
    false,
  );
  await act(() => router.navigate(-1));
  await screen.findByRole("link", { name: "Далее" });
  expect(
    (screen.getByLabelText("Название задания") as HTMLInputElement).value,
  ).toBe("переезд");
  expect(screen.getByText("Страница 2")).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Далее" }));
  await waitFor(() => expect(requests.at(-1)?.get("page")).toBe("3"));
  expect(requests.at(-1)?.get("q")).toBe("переезд");
  expect(requests.at(-1)?.get("city")).toBe("Москва");
  await screen.findByText("Страница 3");
  expect(screen.queryByRole("link", { name: "Далее" })).toBeNull();
});

it("opens API details and returns to the same filtered page", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      json(
        url === "/api/v1/gigs/gig-1"
          ? gig
          : { items: [gig], page: 2, pageSize: 20, total: 21 },
      ),
    ),
  );
  const router = mount("/catalog?city=Москва&page=2");
  fireEvent.click(await screen.findByRole("link", { name: gig.title }));
  await screen.findByText(gig.description);
  expect(screen.getByText(gig.address)).toBeTruthy();
  expect(screen.getByText(gig.customer.name)).toBeTruthy();
  expect(screen.getByText(/1\s234,56/)).toBeTruthy();
  expect(screen.getAllByRole("time")).toHaveLength(2);
  fireEvent.click(screen.getByRole("link", { name: "← К подработкам" }));
  await screen.findByText("Страница 2");
  expect(new URLSearchParams(router.state.location.search).get("city")).toBe(
    "Москва",
  );
});

it("shows loading, retries errors, and offers reset for an empty result", async () => {
  let finish: (response: Response) => void = () => {};
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(
      json({ items: [], page: 1, pageSize: 20, total: 0 }),
    );
  vi.stubGlobal("fetch", fetch);
  mount("/catalog?q=ничего");
  await screen.findByRole("heading", { name: "Загружаем подработки" });
  finish(json({ error: { code: "INTERNAL_ERROR", message: "Ошибка" } }, 500));
  fireEvent.click(
    await screen.findByRole("button", { name: "Попробовать ещё раз" }),
  );
  await screen.findByText("Заданий пока нет");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    screen.getByRole("link", { name: "Все подработки" }).getAttribute("href"),
  ).toBe("/catalog");
});

it("normalizes an invalid page and handles unavailable details", async () => {
  const fetch = vi.fn(async (url: string) =>
    url.startsWith("/api/v1/gigs?")
      ? json({ items: [gig], page: 1, pageSize: 20, total: 1 })
      : json({ error: { code: "NOT_FOUND", message: "Нет задания" } }, 404),
  );
  vi.stubGlobal("fetch", fetch);
  mount("/catalog?page=-10");
  fireEvent.click(await screen.findByRole("link", { name: gig.title }));
  await screen.findByRole("heading", { name: "Задание недоступно" });
  expect(
    new URL(fetch.mock.calls[0][0], "http://localhost").searchParams.get(
      "page",
    ),
  ).toBe("1");
});
