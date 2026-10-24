# Tenant invoice payments

`payment.service.ts` and schema record payments through invoice routes. The service
locks the tenant's invoice, validates the current outstanding balance, rejects
overpayments and preserves invoice status rules. A durable invoice-scoped retry
key prevents duplicate processing. The payment, invoice balance and audit commit
together; conflicting retry details are rejected.

Persisted demo organizations cannot record payments, including idempotent retries.
The live mode guard runs in the transaction before invoice locks or financial writes.

Payment validation never reads cached invoice responses. Successful payments and
replays invalidate dependent invoice, billable-job and dashboard caches after the
transaction/retry completes. Rejected payments leave caches intact. See
`backend/docs/CACHING.md`; tests are under `tests/workflow` and `tests/cache`.
