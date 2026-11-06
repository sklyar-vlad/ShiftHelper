import type { ErrorResponse } from "./generated/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly details?: ErrorResponse["error"],
  ) {
    super(
      details?.message ?? "Сервис временно недоступен. Попробуйте ещё раз.",
    );
  }
}

export const http = async <T>(
  url: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      ErrorResponse | undefined;
    const sessionCheck =
      url === "/api/v1/me" && (init.method ?? "GET") === "GET";
    if (
      response.status === 401 &&
      !sessionCheck &&
      !url.startsWith("/api/v1/auth/") &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event("shifthelper:session-expired"));
    }
    throw new ApiError(response.status, payload?.error);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};
