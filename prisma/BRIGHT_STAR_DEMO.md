# Bright Star Electrical workflow samples

Run from `backend` against the existing local development database:

```sh
npm run seed:bright-star -- dev --dry-run
npm run seed:bright-star -- dev --apply
```

This adds examples only to the existing `bright-star-electrical` tenant. It refuses
production and remote databases. It uses existing active Admin, Manager and Staff
accounts without changing credentials, permissions, organization settings or
subscriptions. Other tenants and all existing business records are preserved.

The whole batch, its histories and its audit records commit in one transaction.
A tenant lock and durable batch marker prevent duplicate concurrent/rerun batches.
Rerunning preserves your edits, payments and status changes. Conflicting unique
customer fields cause a rollback instead of reusing or overwriting another record.
Existing service types are reused without changing their prices or descriptions.
No migration, reset or table deletion is involved. Application caches are
invalidated after commit; refresh the browser to reload its query cache.

## What to explore

- **Dashboard:** current and previous-period activity, today's assigned work,
  overdue work, requests awaiting dispatch, a request ready to close, completed
  jobs ready to invoice, collections and overdue receivables.
- **Customers/catalog:** 12 active households/businesses and one archived former
  customer; nine electrical service types in use or retired (existing types are
  reused). Site access instructions, contacts and meaningful service descriptions.
- **Requests:** 25 cases covering PENDING, IN_PROGRESS, COMPLETED and CANCELLED,
  every priority and unique `SR-BSE-DEMO-*` references. The bakehouse expansion
  (`19`) has three jobs in different stages. Dental lighting (`21`) has all jobs
  finished while its parent still awaits explicit sign-off.
- **Jobs:** 25 work orders with technician assignments, location, schedule, internal
  notes and full status histories. The system calls a not-yet-started job ASSIGNED.
  Rental unit `17` awaits both scheduling and assignment; cold storage `20` is late.
- **Invoices/payments:** 12 itemized invoices covering all four statuses, cent-exact
  totals, unpaid and partially paid overdue balances, future due dates, split
  payments and all five payment methods. Void invoice `09` has no payments.
  Completed requests `11`, `14` and `25` are available for invoicing.
- **Feedback:** nine invitations, six customer responses across all review statuses
  and four private product-feedback submissions attached to the existing users.
  An expired and two current invitations remain unanswered. Comments explicitly
  identify themselves as samples; no publication consent or testimonial approval
  is fabricated. Invitation secrets are discarded; issue new links in the UI for
  unanswered requests when trying the public feedback flow.
- **Audit:** normal module action names and the existing users as simulated actors,
  ordered alongside job status history. Every sample audit has `source:
  bright-star-workflow-v1` and `simulated: true` metadata; a SYSTEM batch entry
  records the counts. Customer submissions use CUSTOMER actors. No credentials,
  private comments or tracking/invitation tokens enter audit metadata.

Dates are relative to the first seed run in Asia/Manila. These examples age
naturally; rerunning does not move dates forward or undo your changes. Customer
details, receipt references and invoice activity are fictional. Email uses the
reserved `.test` domain. No messages are sent. User/role management and subscription
screens retain their existing real setup; the seed does not invent platform billing
events, change access, or consume additional user seats.

Focused checks: `npm test -- --runInBand tests/prisma/bright-star.test.ts`.

Live checks use `npm run test:seed:bright-star:mysql`: pass `-- --rollback-check`
before the initial seed to exercise and abort the complete batch, or
`-- --apply-and-verify` to commit and compare every pre-existing row across all
tenants. No flag verifies an existing batch. These checks validate balances,
ownership, histories, dates, private feedback, real business/staff dashboard
responses and unchanged row digests on reruns. They target fresh, unedited sample
data and the seed day's dashboard; later user changes or date aging may change
the expected results. Digest checks never print record payloads or credentials.
