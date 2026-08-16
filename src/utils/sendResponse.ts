import { Response } from "express";
import { ApiResponse } from "./ApiResponse.js";

export function sendResponse<T>(
  res: Response,
  statusCode: number,
  message: string,
  data: T,
) {
  return res
    .status(statusCode)
    .json(new ApiResponse(statusCode, message, data));
}
