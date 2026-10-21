# Rate-limit verification

`policy.test.ts` uses the real app, root/auth routes, middleware policies, CORS and
error handler. Authentication, controllers and resource child routes are fixtures;
Redis storage is replaced with an in-memory adapter. `store.test.ts` exercises the
installed real RedisStore with a command adapter, including lazy script loading,
prefixes, NOSCRIPT recovery, cold-start failure and safe decrement handling.

Run the normal Jest cases with:

```sh
npm test -- --runInBand tests/rate-limit
```

`runtime.integration.mjs` starts two independent Express processes using actual
middleware, ioredis and RedisStore against a dedicated local Redis on port 16379.
Only authentication/controllers are fixtures. It cannot connect to MySQL or a
remote Redis, uses a unique environment prefix, and sets stricter test-only limits
of three requests to verify boundaries without changing application defaults.

```sh
docker run -d --name serviceflow-rate-audit-20261021 --label com.serviceflow.rate-audit=true -p 127.0.0.1:16379:6379 redis:7-alpine redis-server --save "" --appendonly no
node --import tsx tests/rate-limit/runtime.integration.mjs
```

For outage/recovery verification, stop that dedicated container, start the runner,
and restart the same container from a second terminal after `OUTAGE_CHECKED`:

```sh
docker stop serviceflow-rate-audit-20261021
node --import tsx tests/rate-limit/runtime.integration.mjs --outage
# Second terminal: docker start serviceflow-rate-audit-20261021
```

The runner verifies browsing fails open, login fails closed, the existing
processes recover after Redis restarts, and a successful-login decrement failure
does not crash its process. Stop only the dedicated test container when finished.
Reports are written to sibling `artifacts/rate-limit-20261021/`.

`baseline-runtime.mjs` records the original, unfixed middleware behavior; its
assertions intentionally describe the old shared refresh/login bucket. Preserve
the saved baseline JSON as historical evidence; run the integration script to
verify the current implementation.
