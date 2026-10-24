/** Ошибка, которую можно показать пользователю как есть. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, `${what} не найдено`);
export const conflict = (message: string, details?: unknown) => new AppError(409, message, details);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, message, details);
