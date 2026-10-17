# Tenant invoices

Invoice routes, schema, controller, `invoice.service.ts` and `money.ts` manage
invoices for completed jobs and completed parent requests. Backend line-item
calculations are authoritative. Only unpaid invoices without payments can be
edited or voided. Tenant ownership, unique job invoicing and audits are enforced
inside transactions.

Lists/details use shared Redis caching, preserving Prisma Decimal values on hits.
Invoice and payment writes invalidate invoice projections, billable-job views and
dashboard after commit. Customer edits refresh embedded customer names. Invoice
mutation checks and payment balance validation always query the database. See
`backend/docs/CACHING.md`; tests are under `tests/workflow` and `tests/cache`.
