import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { SessionProvider, useSession } from "./session";
import { RequireUser } from "@/shared/ui/RequireUser";
import { http } from "@/shared/api/http";

const user = {
  id: "user-1",
  name: "Алексей",
  email: "alex@example.test",
  role: "worker" as const,
  bio: "",
  completedGigsCount: 0,
  createdAt: "2026-10-28T10:00:00Z",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  const session = useSession();
  return (
    <>
      <span>
        {session.isPending ? "Загрузка" : (session.user?.name ?? "Гость")}
      </span>
      <button onClick={() => void session.signOut()}>Выйти</button>
      {session.expired && <span>Истекла</span>}
    </>
  );
}

function mount(protectedRoute = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <MemoryRouter initialEntries={["/private"]}>
          {protectedRoute ? (
            <Routes>
              <Route element={<RequireUser role="customer" />}>
                <Route path="/private" element={<p>Закрытая страница</p>} />
              </Route>
              <Route path="/login" element={<p>Нужен вход</p>} />
            </Routes>
          ) : (
            <Probe />
          )}
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe("session", () => {
  it("restores the user and clears personal queries on logout", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith("logout") ? new Response(null, { status: 204 }) : json(user),
    );
    vi.stubGlobal("fetch", fetcher);
    const client = mount();
    await screen.findByText("Алексей");
    client.setQueryData(["private-work"], { title: "Личные данные" });
    fireEvent.click(screen.getByRole("button", { name: "Выйти" }));
    await screen.findByText("Гость");
    expect(client.getQueryData(["private-work"])).toBeUndefined();
  });

  it("treats an expired session as guest and prevents role access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error: { code: "UNAUTHORIZED", message: "Войдите" } }, 401),
      ),
    );
    mount(true);
    await screen.findByText("Нужен вход");
    cleanup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(user)),
    );
    mount(true);
    await screen.findByText("Этот раздел для заказчиков");
    expect(screen.queryByText("Закрытая страница")).toBeNull();
  });

  it("keeps the session after wrong credentials but clears it after a protected 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/v1/me"
          ? json(user)
          : json(
              {
                error: {
                  code: "INVALID_CREDENTIALS",
                  message: "Неверные данные",
                },
              },
              401,
            ),
      ),
    );
    const client = mount();
    await screen.findByText("Алексей");
    await expect(
      http("/api/v1/auth/login", { method: "POST" }),
    ).rejects.toMatchObject({ status: 401, message: "Неверные данные" });
    expect(screen.getByText("Алексей")).not.toBeNull();
    client.setQueryData(["private-work"], { title: "Личные данные" });
    await expect(http("/api/v1/private")).rejects.toMatchObject({
      status: 401,
    });
    await waitFor(() => expect(screen.getByText("Гость")).not.toBeNull());
    expect(screen.getByText("Истекла")).not.toBeNull();
    expect(client.getQueryData(["private-work"])).toBeUndefined();
  });
});
