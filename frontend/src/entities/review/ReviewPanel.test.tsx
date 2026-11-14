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
import { MemoryRouter } from "react-router";
import {
  getGetCurrentUserQueryKey,
  getListGigReviewsQueryKey,
  type CurrentUser,
  type Review,
} from "@/shared/api/generated/api";
import { UserCard } from "@/entities/user/UserCard";
import { StarRating } from "@/shared/ui/StarRating";
import { ReviewPanel } from "./ReviewPanel";

const user: CurrentUser = {
  id: "worker",
  name: "Исполнитель",
  bio: "",
  role: "worker",
  email: "private@example.test",
  createdAt: "2026-11-01T10:00:00Z",
  completedGigsCount: 1,
  ratingAverage: null,
  reviewsCount: 0,
};
const review: Review = {
  id: "review",
  gigId: "gig",
  authorId: user.id,
  recipientId: "customer",
  score: 5,
  comment: "Спасибо за работу",
  createdAt: user.createdAt,
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

it("supports arrow-key selection and restores the selected score after hover", () => {
  let score: number | null = 2;
  const onChange = vi.fn((next: number) => {
    score = next;
  });
  const view = render(<StarRating value={score} onChange={onChange} />);
  const threeStars = screen.getByRole("radio", { name: "3 из 5 — Нормально" });
  const caption = () => view.container.querySelector(".star-rating-caption")!;
  const filledCount = () =>
    view.container.querySelectorAll(".is-filled").length;
  fireEvent.mouseEnter(threeStars.closest("label")!);
  expect(caption().textContent).toBe("3 из 5 — Нормально");
  expect(filledCount()).toBe(3);
  expect(
    (screen.getByRole("radio", { name: "2 из 5 — Плохо" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  fireEvent.mouseLeave(screen.getByRole("group", { name: "Оценка" }));
  expect(caption().textContent).toBe("2 из 5 — Плохо");
  expect(filledCount()).toBe(2);

  const selected = screen.getByRole("radio", { name: "2 из 5 — Плохо" });
  fireEvent.keyDown(selected, { key: "ArrowRight" });
  expect(onChange).toHaveBeenCalledWith(3);
  view.rerender(<StarRating value={score} onChange={onChange} />);
  expect(
    (
      screen.getByRole("radio", {
        name: "3 из 5 — Нормально",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(filledCount()).toBe(3);
});

function mount(handler: (init: RequestInit) => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit = {}) => handler(init)),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  client.setQueryData(getGetCurrentUserQueryKey(), user);
  const rendered = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ReviewPanel gigId="gig" user={user} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { client, ...rendered };
}

it("distinguishes an unrated profile from a real average without exposing email", () => {
  const view = render(<UserCard user={user} />);
  expect(screen.getByText("Пока нет оценок")).toBeTruthy();
  view.rerender(
    <UserCard user={{ ...user, ratingAverage: 14 / 3, reviewsCount: 3 }} />,
  );
  expect(screen.getByText("Рейтинг: 4,7 из 5 · Отзывов: 3")).toBeTruthy();
  expect(screen.queryByText("Пока нет оценок")).toBeNull();
  expect(screen.queryByText(user.email)).toBeNull();
});

it("requires a score, prevents duplicate sends and shows the saved result", async () => {
  let items: Review[] = [];
  let finish: (response: Response) => void = () => {};
  const post = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  mount(async (init) => (init.method === "POST" ? post() : json({ items })));
  const form = await screen.findByRole("form", {
    name: "Оценить вторую сторону",
  });
  fireEvent.submit(form);
  await screen.findByText("Выберите оценку от 1 до 5.");
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio", { name: "5 из 5 — Отлично" }));
  fireEvent.change(screen.getByLabelText("Отзыв (необязательно)"), {
    target: { value: "  Спасибо за работу  " },
  });
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(
    (screen.getByRole("button", { name: "Отправляем…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  const fetchMock = vi.mocked(fetch);
  expect(
    JSON.parse(
      fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1]!
        .body as string,
    ),
  ).toEqual({ score: 5, comment: review.comment });
  items = [review];
  finish(json(review, 201));
  await screen.findByText("Ваша оценка: 5 из 5");
  expect(screen.getByText(review.comment)).toBeTruthy();
  expect(screen.queryByRole("form")).toBeNull();
});

it("keeps the entered values after an error and allows retry", async () => {
  let items: Review[] = [];
  let attempts = 0;
  mount(async (init) => {
    if (init.method !== "POST") return json({ items });
    if (++attempts === 1) throw new Error("network unavailable");
    items = [review];
    return json(review, 201);
  });
  await screen.findByRole("form");
  fireEvent.click(screen.getByRole("radio", { name: "5 из 5 — Отлично" }));
  fireEvent.change(screen.getByLabelText("Отзыв (необязательно)"), {
    target: { value: review.comment },
  });
  fireEvent.click(screen.getByRole("button", { name: "Отправить оценку" }));
  await screen.findByRole("alert");
  expect(
    (screen.getByLabelText("Отзыв (необязательно)") as HTMLTextAreaElement)
      .value,
  ).toBe(review.comment);
  expect(
    (
      screen.getByRole("radio", {
        name: "5 из 5 — Отлично",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Отправить оценку" }));
  await screen.findByText("Ваша оценка: 5 из 5");
  expect(attempts).toBe(2);
});

it("loads an existing review after a conflict and removes the form", async () => {
  let items: Review[] = [];
  mount(async (init) => {
    if (init.method !== "POST") return json({ items });
    items = [review];
    return json(
      {
        error: { code: "ALREADY_REVIEWED", message: "Вы уже оставили оценку." },
      },
      409,
    );
  });
  await screen.findByRole("form");
  fireEvent.click(screen.getByRole("radio", { name: "4 из 5 — Хорошо" }));
  fireEvent.click(screen.getByRole("button", { name: "Отправить оценку" }));
  await screen.findByText("Ваша оценка: 5 из 5");
  expect(screen.queryByRole("form")).toBeNull();
});

it("waits for review loading before allowing a new review and supports retry", async () => {
  let fail = true;
  mount(async () =>
    fail
      ? json({}, 500)
      : json({
          items: [
            review,
            {
              ...review,
              id: "received",
              authorId: "customer",
              recipientId: user.id,
              score: 4,
              comment: "",
            },
          ],
        }),
  );
  await screen.findByText("Не удалось загрузить отзывы");
  expect(screen.queryByRole("form")).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Попробовать ещё раз" }));
  await screen.findByText("Ваша оценка: 5 из 5");
  expect(screen.getByText("Оценка второй стороны: 4 из 5")).toBeTruthy();
  expect(screen.queryByRole("form")).toBeNull();
});

it("does not restore private review data after logout during submission", async () => {
  let finish: (response: Response) => void = () => {};
  const { client, unmount } = mount(async (init) =>
    init.method === "POST"
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : json({ items: [] }),
  );
  await screen.findByRole("form");
  fireEvent.click(screen.getByRole("radio", { name: "5 из 5 — Отлично" }));
  fireEvent.click(screen.getByRole("button", { name: "Отправить оценку" }));
  await waitFor(() =>
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(true),
  );
  unmount();
  client.setQueryData(getGetCurrentUserQueryKey(), null);
  client.removeQueries({ queryKey: getListGigReviewsQueryKey("gig") });
  await act(async () => {
    finish(json(review, 201));
  });
  expect(
    client.getQueryData([...getListGigReviewsQueryKey("gig"), user.id]),
  ).toBeUndefined();
});
