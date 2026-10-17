import z from "zod";
import { permissionIdsSchema, resourceId } from "@/modules/role/role.schema";

export const createRolePermissionSchema = z.object({
  body: z
    .object({
      roleId: resourceId,
      permissionId: resourceId,
    })
    .strict(),
});
export const rolePermissionParamsSchema = z.object({
  params: z.object({ roleId: resourceId }),
});

export const updateRolePermission = z.object({
  params: z.object({ roleId: resourceId }),
  body: z
    .object({
      permissions: permissionIdsSchema,
    })
    .strict(),
});

export type CreateRolePermissionSchema = z.infer<
  typeof createRolePermissionSchema
>["body"];

export type UpdateRolePermissionSchema = z.infer<
  typeof updateRolePermission
>["body"];
