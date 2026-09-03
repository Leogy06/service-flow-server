
import { AsyncLocalStorage } from "async_hooks";

export type RequestContext = {
  requestId: string;
  userId?: string;
  userEmail?: string;
  ip?: string;
  userAgent?: string;
  role?: string;
  organizationId?: string;
  permissions?: string[];
};

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(context: RequestContext, fn: () => T) {
    return storage.run(context, fn);
  },


  get(): RequestContext | undefined {
    return storage.getStore();
  },


  getValue<K extends keyof RequestContext>(
    key: K,
  ): RequestContext[K] | undefined {
    return storage.getStore()?.[key];
  },
};
