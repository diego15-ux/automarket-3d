/**
 * Error de dominio con estado HTTP y un código estable que el frontend puede
 * traducir o usar para redirigir (p. ej. KYC_REQUIRED → /verificacion).
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: string, message: string, details?: Record<string, unknown>) {
    return new AppError(400, code, message, details);
  }

  static unauthorized(code: string, message: string) {
    return new AppError(401, code, message);
  }

  static forbidden(code: string, message: string, details?: Record<string, unknown>) {
    return new AppError(403, code, message, details);
  }

  static notFound(code: string, message: string) {
    return new AppError(404, code, message);
  }

  static conflict(code: string, message: string, details?: Record<string, unknown>) {
    return new AppError(409, code, message, details);
  }

  static tooManyRequests(code: string, message: string) {
    return new AppError(429, code, message);
  }
}
