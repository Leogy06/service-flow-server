export interface AccessTokenPayload {
  sub: string; // user id (cuid)
  role: string;
  organizationId?: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  suffix?: string | null;
  email: string;
  slug?: string | null;
  permissions?: string[];
  platformRole?: "NONE" | "SYSTEM_ADMIN";
  sessionVersion?: number;
}

declare global {
  //eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        organizationId?: string;
        firstName: string;
        lastName: string;
        middleName?: string | null;
        suffix?: string | null;
        email: string;
        slug?: string | null;
        permissions?: string[];
        platformRole?: "NONE" | "SYSTEM_ADMIN";
        securityStatus?: "ACTIVE" | "BLOCKED";
        sessionVersion?: number;
      };
      validated: {
        body: unknown;
        query: unknown;
        params: unknown;
      };
    }
  }
}

export type CreateUserInput = {
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  email: string;
  phone?: string;
  password?: string;
  roleId: string;
  organizationId?: string;
};

