export class AppError extends Error {
  public retryAfterSeconds?: number;
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
    public isOperational = true,
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
