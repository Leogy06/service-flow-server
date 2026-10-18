## [2026-10-18 13:48] Codex

- **Task:** Add one command for local predeployment checks.
- **Summary:** Added `npm run test:predeploy` with sanitized per-command logs, Markdown/JSON reports, local-service safety guards, compiled runtime probes and fresh isolated Linux migration replay. Added runner safety tests and usage documentation; reports are ignored by Git.
- **Files changed:** `package.json`, `.gitignore`, `scripts/predeploy*.mjs`, `scripts/PREDEPLOY.md`, `ACTIVITY.md`.
- **Endpoints / rate limiting:** N/A; no application, API, schema, migration, permission or rate-limit changes. GET health/auth smoke probes exercise existing local rate-limit counters.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Final complete run: 24 PASS, 2 FAIL, 2 BLOCKED (exit 1). Backend 33 suites/791 tests, frontend 29 tests, runner 3 safety tests, both lint/type/build/start checks, MySQL/Redis, configured migration status and fresh Linux replay passed. Production configuration fails for CORS_ORIGIN, NEXT_PUBLIC_API_URL and SITE_URL. App Docker/proxy and external/browser/restore/load acceptance remain blocked. Corrected initial Jest discovery conflict by naming Node safety tests outside Jest's test patterns. Two uniquely named test containers were stopped with data retained; configured DB was read-only. Reports: `.predeploy/2026-10-18T05-45-47-743Z-5dc7a1/`.
