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
import { AccountPage } from "@/pages/account/AccountPage";
import { AuthPage } from "./AuthPage";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const guest = () =>
  json({ error: { code: "UNAUTHORIZED", message: "Войдите" } }, 401);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(mode: "login" | "register") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <MemoryRouter initialEntries={[`/${mode}`]}>
          <Routes>
            <Route path={`/${mode}`} element={<AuthPage mode={mode} />} />
            <Route path="/profile" element={<AccountPage />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return client;
}

it("shows an occupied email and preserves ordinary fields", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/v1/me"
        ? guest()
        : json({ error: { code: "EMAIL_TAKEN", message: "Email занят" } }, 409),
    ),
  );
  mount("register");
  await screen.findByLabelText("Ваше имя");
  fireEvent.change(screen.getByLabelText("Ваше имя"), {
    target: { value: "Алексей" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "alex@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Пароль"), {
    target: { value: "test-password" },
  });
  fireEvent.click(screen.getByLabelText(/Нужна помощь/));
  fireEvent.submit(screen.getByRole("form", { name: "Создать аккаунт" }));
  await screen.findByText(/Этот email уже зарегистрирован/);
  expect((screen.getByLabelText("Ваше имя") as HTMLInputElement).value).toBe(
    "Алексей",
  );
  expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
    "alex@example.test",
  );
  expect((screen.getByLabelText("Пароль") as HTMLInputElement).value).toBe("");
  expect(
    (screen.getByLabelText(/Нужна помощь/) as HTMLInputElement).checked,
  ).toBe(true);
});

it("keeps email after a network error and never caches the password", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/v1/me") return guest();
      throw new TypeError("network");
    }),
  );
  const client = mount("login");
  await screen.findByLabelText("Email");
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "alex@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Пароль"), {
    target: { value: "test-password" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Войти в аккаунт" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
    "alex@example.test",
  );
  expect((screen.getByLabelText("Пароль") as HTMLInputElement).value).toBe("");
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain("test-password");
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});

it("blocks duplicate requests and opens the authenticated profile", async () => {
  let finish: (value: Response) => void = () => {};
  const login = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url === "/api/v1/me" ? guest() : login())),
  );
  mount("login");
  await screen.findByLabelText("Email");
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "alex@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Пароль"), {
    target: { value: "test-password" },
  });
  const form = screen.getByRole("form", { name: "Войти в аккаунт" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
  expect(
    (screen.getByRole("button", { name: "Входим…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  finish(
    json({
      id: "user-1",
      name: "Алексей",
      email: "alex@example.test",
      role: "customer",
      bio: "",
      completedGigsCount: 0,
      createdAt: "2026-10-28T10:00:00Z",
    }),
  );
  await screen.findByRole("heading", { name: "Мой профиль" });
  expect(screen.getByText("Заказчик")).not.toBeNull();
});
