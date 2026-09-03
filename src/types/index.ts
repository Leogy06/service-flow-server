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
        slug?:string | null;
        permissions?: string[];
      };
      validated: {
        body: unknown;
        query: unknown;
        params: unknown;
      };
    }
  }
}
