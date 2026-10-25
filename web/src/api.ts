/** Ошибка API с текстом по-русски от сервера. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: string; details?: unknown } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Ошибка ${res.status}`, data?.details);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

/** Текст ошибки для человека: сообщение и подробности проверки данных. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const details = Array.isArray(error.details)
      ? (error.details as { message?: string }[]).map((d) => d.message).filter(Boolean)
      : [];
    return details.length > 0 ? `${error.message}: ${details.join('; ')}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
