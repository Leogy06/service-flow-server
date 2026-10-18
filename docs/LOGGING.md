# Backend logging

`src/lib/logger.ts` configures Pino. `src/middleware/request-logger.ts` runs
before other Express middleware and records each completed or aborted request,
including OPTIONS preflights, authentication failures, rate limits and 404s.
Requests that never reach Express or a process crash are outside this coverage.

Request summaries contain a server-generated request ID, HTTP method, path
without query values, remote address, response status and elapsed milliseconds.
The request ID is also returned as `X-Request-Id`. Request/response bodies,
query objects, route parameters and headers are omitted to avoid recording
credentials and customer payloads. Never put credentials in URL paths or log
sensitive objects manually; Pino's existing redaction is additional protection,
not a substitute for safe fields and messages.

Successful responses use `info`, 4xx responses use `warn` and 5xx/errors use
`error`. Keep `LOG_LEVEL=info` to retain every request summary; higher levels
filter out lower-severity requests. Tests are silent. Development uses the
pretty console output only. Production writes JSON to stdout and rolling files
under `logs/`, relative to the backend process's working directory.

Files rotate daily or at approximately 10 MiB, whichever happens first.
`LOG_MAX_FILES` is a validated positive integer, defaulting to 14. At rotation,
pino-roll prunes matching files, including files from previous runs. Budget for
up to 14 retained files plus the active file (15 total). This is file-count
retention, not a guarantee of 14 days of history. The nominal file budget is
about 150 MiB with the default; buffered writes can exceed the per-file threshold.
Existing surplus files are pruned on the next rotation, not immediately on
startup. No additional scheduler, cron job or dependency is needed.

Use a separate log directory/volume per running instance. Do not let multiple
processes rotate and clean the same directory. Files in `logs/` are ignored by
Git and are runtime data; they consume disk space rather than growing the
application's source code. They must not be served publicly or exposed through
tenant endpoints. Configure retention separately for any hosting service that
collects stdout. A container's local files are lost if its storage is ephemeral.

These operational logs are separate from database audit records. This policy
does not delete audit records, customer records or any other application data.

References: [pino-http](https://github.com/pinojs/pino-http#readme),
[pino-roll](https://github.com/mcollina/pino-roll#readme).
