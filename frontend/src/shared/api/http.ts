export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

// Shared fetch mutator for the Orval-generated API client.
export const http = async <T>(
  url: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetch(url, init);
  if (!response.ok) throw new ApiError(response.status);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};
