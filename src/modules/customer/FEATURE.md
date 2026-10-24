# Customers

Customer routes, schema, controller and `customer.service.ts` manage tenant-owned
customers with search, filtering, pagination and soft-delete/restore. Tenant scope
comes from request context. Name, email and phone uniqueness is organization-scoped;
archived identifiers stay reserved within the same organization. Apply forward
migration `20261024090000_customer_tenant_uniqueness` after exact-target review;
old global indexes will otherwise continue rejecting cross-tenant duplicates.

Create/update/archive/restore and their mandatory audit evidence commit in the
existing serializable tenant transaction. Audit failures roll back the mutation;
cache invalidation follows successful commit. Reads keep active/archived separation.

Lists/details use `utils/module-cache.ts` through the shared Redis utility.
Successful create/update/delete/restore invalidates the tenant's customers,
request customer choices, requests, jobs, invoices and dashboard because those
views embed customer names or counts. Ownership and mutation checks always query
the database. See `backend/docs/CACHING.md`; tests are under `tests/customer` and
`tests/cache`.
