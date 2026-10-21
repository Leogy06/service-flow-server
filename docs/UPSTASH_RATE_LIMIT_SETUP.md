# Reminder: configure Upstash before preview/production

Upstash verification is deferred at the user's request. Local development can
use the validated default `redis://localhost:6379`; the default request budgets
are already defined centrally and loaded by `src/config/env.ts`. There is no
fake Upstash URL or credential fallback in application code. Production rejects
plain local Redis and requires a real TLS connection.

- [ ] Create/select a **preview or staging** Upstash Redis database first.
- [ ] Set REDIS_URL privately to its ioredis TCP `rediss://...` URL, not the HTTPS
  REST endpoint. Do not commit the password or paste it into documentation.
- [ ] Set APP_ENV to a stable distinct namespace such as `preview-my-branch`;
  production should use `production`. VERCEL_ENV/NODE_ENV supply fallback names.
- [ ] Review `.env.example` and `src/config/rate-limit.ts`. Starting values:
  API 300/min, WRITE 30/min, REFRESH 60/min, AUTH 10 failed/15min, SIGNUP 5/10min,
  STRICT 5/hour, REFUND 10/hour. Keep the sensitive defaults unless a separate
  security review justifies changes. Each has MAX and WINDOW_MS environment keys.
- [ ] Keep Redis offline queue disabled and the bounded timeout/retry defaults.
- [ ] Configure exact CORS_ORIGIN and verify the actual proxy chain using the
  temporary one-request TRUST_PROXY_DIAGNOSTICS setting; then turn it off.
- [ ] Run the [validation checklist](RATE_LIMITING.md) on staging: actual login,
  successful refresh separation, repeated failed login blocking, two users on the
  same IP, shared limits across instances, readable 429 headers/body and 10+ pages
  in each layout. Measure real endpoint latency and Upstash commands.
- [ ] Exercise a Redis outage only in isolated staging: authenticated browsing
  should fail open; login/signup/refresh/password/refund/write protection should
  fail closed with 503 and recover after Redis returns.

No live Upstash test has passed yet. The local Docker/fixture evidence and the
production frontend sample build do not replace this deployment check.
