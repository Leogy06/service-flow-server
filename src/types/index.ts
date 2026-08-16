export interface User {
  id: number;
  email: string;
  password: string;
  role: "user" | "admin";
  tokenVersion: number;
}

export interface AccessTokenPayload {
  sub: number;
  role: string;
}

export interface RefreshTokenPayload {
  sub: number;
  tokenVersion: number;
}

// Extend Express's Request type to carry our decoded user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: number;
        role: string;
      };
    }
  }
}
