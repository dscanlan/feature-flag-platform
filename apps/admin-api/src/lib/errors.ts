export class AppError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(httpStatus: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (resource: string, key: string): AppError =>
  new AppError(404, "NOT_FOUND", `${resource} not found: ${key}`);

export const conflict = (msg: string, details?: unknown): AppError =>
  new AppError(409, "CONFLICT", msg, details);

export const validation = (msg: string, details?: unknown): AppError =>
  new AppError(400, "VALIDATION_ERROR", msg, details);
