# Upstash Redis setup

Service Flow uses the existing `ioredis` client over TCP with TLS. One backend-only
`REDIS_URL` configures both read caching and the shared API rate-limit store.
No new SDK, account API key, REST URL or REST token environment variable is needed.
The database password is the credential inside the URL.

## 1. Create the database

1. Sign in at <https://console.upstash.com/> and select Redis, then Create Database.
2. Name it, for example `serviceflow-production`. Choose the primary region closest
   to the **backend server**. Use a separate database for development/staging:
   response-cache keys do not have an environment prefix. Rate-limit keys use
   `rl:<APP_ENV or VERCEL_ENV or NODE_ENV>:<limiter>:`; set a distinct `APP_ENV`
   for each preview that should have independent counters.
3. Select a plan suited to your expected traffic. Review current quotas and monitor
   commands, storage and connections; each API request can use several Redis
   commands for rate limits and cache generation lookups.
4. Keep **Eviction disabled**. This database holds rate-limit counters and cache
   generation keys as well as response entries. Eviction can reset limits or
   undermine invalidation. Monitor capacity: a full database rejects writes.
5. Open the database's Connect section, choose TCP / ioredis and copy its full
   connection URL. It should look like:

   ```dotenv
   REDIS_URL=rediss://default:YOUR_DATABASE_PASSWORD@YOUR_ENDPOINT:6379
   ```

   Use the exact endpoint, port and password supplied by Upstash. The `rediss://`
   prefix enables TLS with certificate verification. If constructing a URL by
   hand, percent-encode special characters in the password. The HTTPS REST URL
   belongs to a different client and will be rejected by Service Flow's validator.

## 2. Configure the backend

For native development, replace only `REDIS_URL` in `backend/.env.development`; retain the
other required variables. Restart `npm run dev` from `backend/`.

For the VPS Compose deployment, set `REDIS_URL` in `deploy/.env`. The base
`deploy/compose.yml` now uses external Redis and does not start a Redis container.
It passes the URL to Express at runtime. The backend's web network permits outbound
TLS connections; allow outbound access to the database's TCP port if your hosting
firewall restricts egress. Do not publish a Redis port on the VPS.

Keep the completed env files private and out of Git. Do not put the URL in frontend
environment variables, build arguments, screenshots, logs or chat messages.

From project root, validate without printing resolved secrets, build the updated
backend and recreate it (after the deployment's normal backup/migration review):

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yml build backend
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --no-deps backend
```

On first deployment follow `deploy/README.md` to start the entire stack instead.

## 3. Check the connection

From `backend/`, with its complete private `.env` configured:

```sh
node --import tsx --input-type=module -e "const {redis}=await import('./src/lib/redis.ts');try{console.log(await redis.ping());}catch{console.error('Redis check failed; check REDIS_URL and network access');process.exitCode=1;}finally{redis.disconnect();}"
```

For the running VPS container, from project root:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml exec -T backend node --input-type=module -e "const {redis}=await import('./dist/lib/redis.js');try{console.log(await redis.ping());}catch{console.error('Redis check failed; check REDIS_URL and network access');process.exitCode=1;}finally{redis.disconnect();}"
```

Expect `PONG` and a `Redis ready` log. `/api/health` alone does not check Redis.
The authenticated system-admin monitoring view also probes Redis. Exercise normal
API reads/writes and check Upstash metrics after switching. Incorrect passwords
cause authentication errors; connection resets often indicate missing `rediss://`;
timeouts can indicate DNS, firewall, endpoint or port problems.

## Cutover and local tests

Response caches rebuild automatically from MySQL. Moving to an empty database
resets rate-limit counters for their active windows; coordinate the cutover and
restart every backend instance/CLI with the same new URL. MySQL data, sessions,
permissions and cache key scoping are unaffected.

An old Docker Redis container may remain after updating Compose. Once all clients
use Upstash and checks pass, stop that specific old container. Keep its volume for
rollback; do not run volume deletion or database reset commands.

The isolated VPS test automatically adds `deploy/compose.redis-local.yml` and uses
generated local credentials. It does not connect to your Upstash database. To run
a self-hosted stack intentionally, set `REDIS_PASSWORD` and a matching
`REDIS_URL=redis://:YOUR_LOCAL_PASSWORD@redis:6379` in its private env file, and add
`-f deploy/compose.redis-local.yml` to **every** Compose command after the base file.
Native local Redis still supports `redis://localhost:6379`.

Read caches fall back to MySQL during Redis failures. Authenticated browsing's
`apiLimiter` fails open and logs store failures; login, signup, refresh, password
reset, writes and other sensitive limiters fail closed. There is no in-memory
fallback that would lose the shared security budget. The shared ioredis TCP
client has configurable connect/command timeouts (both 2 seconds by default),
one retry per request and no offline queue. Warm serverless invocations reuse the
connection; script initialization retries after Redis recovers. Cache TTLs and
tenant/user/permission boundaries are unchanged.

For standalone local Redis, `docker compose up -d --wait redis` from the backend
starts the loopback-only service in `docker-compose.yml`, with an AOF named volume
and healthcheck. Set `REDIS_PORT` if 6379 is occupied, and update local `REDIS_URL`
to the same port. `docker compose stop redis` preserves data. This file is for
local development; production still uses the verified `rediss://` TCP URL.

Official references: [Getting started](https://upstash.com/docs/redis/overall/getstarted),
[Connect your client](https://upstash.com/docs/redis/howto/connect-client),
[TLS troubleshooting](https://upstash.com/docs/redis/troubleshooting/econn_reset),
[Eviction](https://upstash.com/docs/redis/features/eviction).
