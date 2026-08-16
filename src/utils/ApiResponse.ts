export class ApiResponse<T = unknown> {
  public success: true;
  public statusCode: number;
  public message: string;
  public data: T;

  constructor(statusCode: number, message: string, data: T) {
    this.success = true;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
  }
}
