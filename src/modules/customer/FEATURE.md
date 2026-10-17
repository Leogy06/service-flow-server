# Customers

Customer routes, schema, controller and `customer.service.ts` manage tenant-owned
customers with search, filtering, pagination and soft-delete/restore. Tenant scope
comes from request context. Updates preserve existing uniqueness checks and audit
behavior; archived records remain separate from active results.

Lists/details use `utils/module-cache.ts` through the shared Redis utility.
Successful create/update/delete/restore invalidates the tenant's customers,
request customer choices, requests, jobs, invoices and dashboard because those
views embed customer names or counts. Ownership and mutation checks always query
the database. See `backend/docs/CACHING.md`; tests are under `tests/customer` and
`tests/cache`.
