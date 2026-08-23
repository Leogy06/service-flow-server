import { Role } from "@/generated/prisma/client.js";
export interface AccessTokenPayload {
  sub: string; // user id (cuid)
  role: Role;
  organizationId?: string;
}

declare global {
  //eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
        organizationId?: string;
      };
      validated: {
        body: unknown;
        query: unknown;
        params: unknown;
      };
    }
  }
}
