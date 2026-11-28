import { ErrorCode, type ErrorResponse } from "./generated/api";

let sessionVersion = 0;

export function invalidateHttpSession() {
  sessionVersion++;
}

function errorDetails(payload: unknown): ErrorResponse["error"] | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return;
  const value = payload.error;
  if (!value || typeof value !== "object") return;
  const error = value as Record<string, unknown>;
  if (
    !Object.values(ErrorCode).includes(error.code as ErrorCode) ||
    typeof error.message !== "string" ||
    !error.message.trim() ||
    error.message.length > 1000
  )
    return;
  const fields = error.fields;
  if (
    fields !== undefined &&
    (!fields ||
      typeof fields !== "object" ||
      Array.isArray(fields) ||
      !Object.values(fields).every(
        (messages) =>
          Array.isArray(messages) &&
          messages.every(
            (message) =>
              typeof message === "string" &&
              message.length > 0 &&
              message.length <= 500,
          ),
      ))
  )
    return;
  return {
    code: error.code as ErrorCode,
    message: error.message,
    ...(error.code === "VALIDATION_ERROR" && fields
      ? { fields: fields as Record<string, string[]> }
      : {}),
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly details?: ErrorResponse["error"],
    readonly retryAfter?: number,
  ) {
    super(
      status === 429
        ? retryAfter
          ? `Слишком много попыток. Попробуйте через ${retryAfter} сек.`
          : "Слишком много попыток. Подождите немного и попробуйте ещё раз."
        : (details?.message ??
            (status === 401
              ? "Сессия истекла. Войдите снова."
              : status === 403
                ? "Это действие недоступно для вашего аккаунта."
                : status === 404
                  ? "Данные не найдены или больше недоступны."
                  : status === 409
                    ? "Данные изменились. Обновите страницу и попробуйте ещё раз."
                    : "Сервис временно недоступен. Попробуйте ещё раз.")),
    );
  }
}

export const http = async <T>(
  url: string,
  init: RequestInit = {},
): Promise<T> => {
  const version = sessionVersion;
  const ensureCurrent = () => {
    if (init.signal?.aborted || version !== sessionVersion)
      throw new DOMException("Request cancelled", "AbortError");
  };
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", ...init });
  } catch (error) {
    ensureCurrent();
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError(0);
  }
  ensureCurrent();
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined);
    ensureCurrent();
    const sessionCheck =
      url === "/api/v1/me" && (init.method ?? "GET") === "GET";
    if (
      response.status === 401 &&
      !sessionCheck &&
      !url.startsWith("/api/v1/auth/") &&
      typeof window !== "undefined"
    )
      window.dispatchEvent(new Event("shifthelper:session-expired"));
    const retryAfter = Number(response.headers.get("Retry-After"));
    throw new ApiError(
      response.status,
      response.status < 500 ? errorDetails(payload) : undefined,
      Number.isSafeInteger(retryAfter) && retryAfter > 0
        ? retryAfter
        : undefined,
    );
  }
  if (response.status === 204) return undefined as T;
  try {
    const payload: T = await response.json();
    ensureCurrent();
    return payload;
  } catch (error) {
    ensureCurrent();
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError(response.status);
  }
};
