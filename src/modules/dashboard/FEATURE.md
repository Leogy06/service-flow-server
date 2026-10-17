# Tenant dashboard

Dashboard route/controller, `dashboard.service.ts` and `periods.ts` provide a
read-only transaction snapshot of permitted jobs, requests, billing and customer
metrics using Manila reporting periods. Business and staff views differ; staff
job summaries are restricted to the current user. Each section requires its
effective read permission, and the route requires dashboard access.

Responses are cached for 30 seconds by tenant, user, role and sorted effective
permissions. The service checks dashboard permission before a cache lookup.
Related business, user and role writes invalidate the tenant's dashboard after
commit; time alone is bounded by the short TTL. See `backend/docs/CACHING.md`;
tests are under `tests/dashboard` and `tests/cache`.
