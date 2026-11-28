import { afterEach, expect, it, vi } from "vitest";
import { ApiError, http, invalidateHttpSession } from "./http";

const json = (value: unknown, status = 400) =>
  new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllGlobals());

it.each([
  null,
  { error: "upstream failed" },
  { error: { code: "VALIDATION_ERROR", message: { sql: "private" } } },
  {
    error: {
      code: "VALIDATION_ERROR",
      message: "Ошибка",
      fields: { email: "SQL detail" },
    },
  },
  { error: { code: "UNKNOWN", message: "SQL stack trace" } },
])(
  "handles malformed error responses without exposing their bodies: %j",
  async (payload) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(payload)),
    );
    await expect(http("/api/v1/gigs")).rejects.toMatchObject({
      status: 400,
      details: undefined,
      message: "Сервис временно недоступен. Попробуйте ещё раз.",
    });
  },
);

it("hides JSON and HTML server errors, including field details", async () => {
  for (const response of [
    json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "SQL connection secret",
          fields: { email: ["stack trace"] },
        },
      },
      500,
    ),
    new Response("<h1>nginx failed</h1>", { status: 502 }),
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    await expect(http("/api/v1/gigs")).rejects.toMatchObject({
      details: undefined,
      message: "Сервис временно недоступен. Попробуйте ещё раз.",
    });
  }
});

it("preserves valid validation messages", async () => {
  const error = {
    code: "VALIDATION_ERROR",
    message: "Проверьте поля",
    fields: { email: ["Укажите email"] },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ error })),
  );
  await expect(
    http("/api/v1/auth/register", { method: "POST" }),
  ).rejects.toMatchObject({ details: error });
});

it("normalizes a network failure and a non-JSON success response", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network internals"))
      .mockResolvedValueOnce(new Response("proxy page")),
  );
  await expect(http("/api/v1/gigs")).rejects.toBeInstanceOf(ApiError);
  await expect(http("/api/v1/gigs")).rejects.toMatchObject({
    status: 200,
    details: undefined,
  });
});

it("does not expire the session for an aborted request", async () => {
  const expired = vi.fn();
  window.addEventListener("shifthelper:session-expired", expired);
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      controller.abort();
      return json({}, 401);
    }),
  );
  try {
    await expect(
      http("/api/v1/private", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(expired).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("shifthelper:session-expired", expired);
  }
});

it.each([200, 401])(
  "discards a late response from a previous session: %i",
  async (status) => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const expired = vi.fn();
    window.addEventListener("shifthelper:session-expired", expired);
    try {
      const request = http("/api/v1/private");
      invalidateHttpSession();
      finish(json({ id: "old-private-data" }, status));
      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(expired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("shifthelper:session-expired", expired);
    }
  },
);
