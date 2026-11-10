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
import { SessionProvider } from "@/shared/model/session";
import { getGetCurrentUserQueryKey } from "@/shared/api/generated/api";
import { UserCard } from "@/entities/user/UserCard";
import { AccountPage } from "./AccountPage";

const user = {
  id: "user-1",
  name: "Алексей",
  bio: "Описание",
  email: "private@example.test",
  role: "worker" as const,
  completedGigsCount: 0,
  ratingAverage: null,
  reviewsCount: 0,
  createdAt: "2026-10-28T10:00:00Z",
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

async function mount(send: (init: RequestInit) => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) =>
      init.method === "PATCH" ? send(init) : json(user),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <AccountPage />
      </SessionProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Редактировать профиль" }),
  );
  return client;
}
const submit = () =>
  fireEvent.submit(
    screen.getByRole("form", { name: "Редактирование профиля" }),
  );

it("saves trimmed name and empty bio, updating the session immediately", async () => {
  const send = vi.fn(async (init: RequestInit) =>
    json({ ...user, ...JSON.parse(init.body as string) }),
  );
  const client = await mount(send);
  fireEvent.change(screen.getByLabelText("Имя"), {
    target: { value: "  Новое имя  " },
  });
  fireEvent.change(screen.getByLabelText("О себе"), {
    target: { value: "  " },
  });
  submit();
  await screen.findByText("Профиль сохранён.");
  expect(JSON.parse(send.mock.calls[0][0].body as string)).toEqual({
    name: "Новое имя",
    bio: "",
    contact: "",
  });
  expect(screen.getByRole("heading", { name: "Новое имя" })).toBeTruthy();
  expect(screen.getByText("Описание пока не добавлено")).toBeTruthy();
  expect(client.getQueryData(getGetCurrentUserQueryKey())).toMatchObject({
    name: "Новое имя",
    bio: "",
  });
});

it("validates name and preserves input on API field errors, while blocking duplicate sends", async () => {
  let finish: (response: Response) => void = () => {};
  const send = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  await mount(send);
  fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "  " } });
  submit();
  await screen.findByText("Укажите имя от 1 до 100 символов.");
  expect(send).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Имя"), {
    target: { value: "Новое имя" },
  });
  submit();
  submit();
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(
    (screen.getByRole("button", { name: "Сохраняем…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  finish(
    json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Ошибка",
          fields: { bio: ["Проверьте описание"] },
        },
      },
      400,
    ),
  );
  await screen.findByText("Проверьте описание");
  expect((screen.getByLabelText("Имя") as HTMLInputElement).value).toBe(
    "Новое имя",
  );
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  expect(screen.getByRole("heading", { name: "Алексей" })).toBeTruthy();
});

it("does not restore a logged-out session when a late save response arrives", async () => {
  let finish: (response: Response) => void = () => {};
  const send = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const client = await mount(send);
  submit();
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  await act(async () => {
    client.setQueryData(getGetCurrentUserQueryKey(), null);
  });
  await act(async () => {
    finish(json(user));
  });
  expect(client.getQueryData(getGetCurrentUserQueryKey())).toBeNull();
});

it("renders only public profile fields, including zero completed gigs", () => {
  render(<UserCard user={{ ...user, bio: "" }} />);
  expect(screen.getByText("Алексей")).toBeTruthy();
  expect(screen.getByText(/Завершено заданий: 0/)).toBeTruthy();
  expect(screen.getByText("Описание пока не добавлено")).toBeTruthy();
  expect(screen.queryByText(user.email)).toBeNull();
});

it("saves and clears the optional private contact", async () => {
  const send = vi.fn(async (init: RequestInit) =>
    json({ ...user, ...JSON.parse(init.body as string) }),
  );
  await mount(send);
  fireEvent.change(screen.getByLabelText("Как со мной связаться"), {
    target: { value: "  @contact  " },
  });
  submit();
  await screen.findByText("Профиль сохранён.");
  expect(JSON.parse(send.mock.calls[0][0].body as string).contact).toBe(
    "@contact",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Редактировать профиль" }),
  );
  fireEvent.change(screen.getByLabelText("Как со мной связаться"), {
    target: { value: "" },
  });
  submit();
  await screen.findByText("Профиль сохранён.");
  expect(JSON.parse(send.mock.calls[1][0].body as string).contact).toBe("");
});
