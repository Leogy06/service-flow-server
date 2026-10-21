import type { Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis, redisReady } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { AppError } from "@/utils/AppError";

// One instance per limiter. A failed cold-start SCRIPT LOAD must be retryable on
// the next request, rather than leaving a rejected SHA promise cached forever.
export class RecoverableRateLimitStore extends RedisStore {
  private configuration?: Options;
  private initialization?: Promise<void>;
  private initialized = false;

  constructor(private readonly name: string, prefix: string, private readonly failOpen: boolean) {
    super({
      prefix,
      sendCommand: (...args: string[]) => redis.call(args[0]!, ...args.slice(1)) as Promise<string>,
    });
  }

  private report(operation: string): void {
    // Do not log Redis command objects: AUTH arguments can contain credentials.
    logger.error({ limiter: this.name, operation, failOpen: this.failOpen },
      this.failOpen ? "RATE LIMIT STORE UNAVAILABLE: allowing general API traffic" : "RATE LIMIT STORE UNAVAILABLE: blocking protected action");
  }

  private ready(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (!this.initialization) {
      this.initialization = redisReady().then(() => super.init(this.configuration!)).then(() => {
        this.initialized = true;
      }).finally(() => {
        this.initialization = undefined;
      });
    }
    return this.initialization;
  }

  override async init(options: Options): Promise<void> {
    this.configuration = options;
    // Load scripts on the first request, where rejection is observed below.
    // This also avoids loading both scripts for every unused policy at cold start.
  }

  override async increment(key: string) {
    try {
      await this.ready();
      return await super.increment(key);
    } catch {
      this.initialized = false;
      this.report("increment");
      // express-rate-limit applies passOnStoreError; closed policies return this
      // operational error through the shared AppError handler.
      throw new AppError(503, "Request protection is temporarily unavailable. Please try again later.", "RATE_LIMIT_STORE_UNAVAILABLE");
    }
  }

  override async decrement(key: string): Promise<void> {
    try { await super.decrement(key); } catch {
      // skipSuccessfulRequests runs after sending the response without catching
      // rejected decrements. Retaining the hit is the conservative failure mode.
      this.report("decrement");
    }
  }

  override async get(key: string) {
    try {
      await this.ready();
      return await super.get(key);
    } catch {
      this.initialized = false;
      this.report("get");
      throw new AppError(503, "Request protection is temporarily unavailable. Please try again later.", "RATE_LIMIT_STORE_UNAVAILABLE");
    }
  }
}
