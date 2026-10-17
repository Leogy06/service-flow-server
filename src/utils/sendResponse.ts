import { Response } from "express";
import { ApiResponse } from "./ApiResponse";

export function sendResponse<T>(
  res: Response,
  statusCode: number,
  message: string,
  data: T,
) {
  return res.status(statusCode);
  on(new ApiResponse(statusCode, message, data));
}
