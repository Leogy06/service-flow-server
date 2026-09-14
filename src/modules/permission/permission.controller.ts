import { CreatePermissionSchema } from "./permission.schema.js";
import { permissionService } from "./permission.service.js";
import { sendResponse } from "@/utils/sendResponse.js";
import {NextFunction, Request, Response} from "express";

export const permissionController ={
    async create(req:Request, res:Response, next:NextFunction) {
        try {
            const validated = req.validated.body as CreatePermissionSchema;
            const permission = await permissionService.create(validated);
            sendResponse(res, 201, "Permission created successfully", permission);

        }catch (e) {
            next(e)
        }
    }
}