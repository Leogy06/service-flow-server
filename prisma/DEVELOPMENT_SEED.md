# Full local development seed

From `backend`, after configuring `.env.development` and applying the existing
schema to your local database:

```sh
npm run seed:dev                    # read-only preview
npm run seed:dev -- --apply         # add the full sample workspace
```

Set `DEV_SEED_PASSWORD` in your private `.env.development` first for apply. It uses
the existing registration password rules (8–72 characters, uppercase, lowercase,
number). The password and its hash are never printed. All **new** sample accounts
use this password; subsequent seeds preserve credentials and user edits. Sign in
through the usual login page. No emails are sent or sessions/tokens manufactured.

| Workspace | Login emails |
| --- | --- |
| Platform administration | `leogy_santiIIan850@outlook.com` |
| Acme Plumbing | `admin@acme-plumbing.example.test`, `manager@acme-plumbing.example.test`, `staff@acme-plumbing.example.test` |
| Bright Star Electrical | `admin@bright-star-electrical.example.test`, `manager@bright-star-electrical.example.test`, `staff@bright-star-electrical.example.test` |
| Summit HVAC | `admin@summit-hvac.example.test`, `manager@summit-hvac.example.test`, `staff@summit-hvac.example.test` |

Includes global permission definitions and six subscription plans, the existing
Admin/Manager/Staff permission defaults for newly created roles, one platform
operator, three organizations, branding settings, public sample business pages,
platform settings and one explicit staff user-permission denial per organization
(`customer:update`). Existing roles and grants are preserved.

Bright Star receives the existing [detailed electrical scenarios](BRIGHT_STAR_DEMO.md):
13 customers, nine service types, 25 requests, 25 jobs and their histories, 12
itemized invoices, split/partial/full payments, overdue and cancelled work,
private customer/product feedback and audit records. An existing electrical
sample batch is reused. Acme and Summit each receive their industry service
catalog, a separate customer and completed request/job with history, invoice and
partial payment, making tenant isolation easy to exercise.

New subscriptions demonstrate an active paid yearly subscription (electrical),
14-day trial (HVAC) and pending subscription with a receipt under review (plumbing).
The newly created plumbing organization has billing enforcement disabled so its
accounts remain usable during review. A paid receipt, history, open refund request,
payment-review alert and pending signup populate platform screens. Approve the
pending receipt or refund through the normal platform workflows. No actual money
is transferred and a refund is not completed by the seed. A sample signup at
`applicant@sample-cleaning.example.test` uses the same password with explicitly
synthetic agreement evidence; it is fictional test data, not a real acceptance.
Existing subscriptions, billing flags and platform configuration are preserved.

Safety and repeatability:

- `seed:dev` selects `.env.development` through the existing environment wrapper.
  Both the wrapper and seed refuse production and remote MySQL targets, including
  direct invocation of the seed outside the wrapper.
- The entire catalog, account and workflow batch commits in one serializable
  transaction with audits and a durable completion marker. A failure rolls it all
  back. Concurrent conflicts fail safely; rerun after the other command completes.
- No reset, table clearing, migrations, schema changes or account promotion by
  email is performed. Reserved email, ID or customer uniqueness collisions fail
  instead of overwriting or connecting another tenant's records.
- Existing matching organizations are reused only if active; existing roles,
  settings, plan prices and billing records remain unchanged. Retired plans or
  insufficient Starter Yearly seats cause an error rather than reactivation.
  Reused organizations must also have sufficient subscription seats for the new
  accounts, including existing pending invitations.
- Dates anchor to the first successful run. Repeat applies preserve your edits,
  passwords, status changes and original dates; they still fill missing global
  catalog entries and invalidate relevant application caches. Trials expire
  naturally. Seed again into a separate empty local database for a fresh workspace.
- Dry run previews catalogs and planned account/workspace coverage; apply performs
  full FK/uniqueness/actor checks. Refresh the browser after apply to reload queries.

Refresh tokens are created by login. Completed refunds and subscription upgrades
are produced through their audited business workflows rather than dummy rows.
The sample feedback never has publication consent or testimonial approval.
Source seed commands require backend development dependencies and generated Prisma.

Verification: `npm test -- --runInBand tests/prisma` and
`npm run test:config:prisma`. Before the initial apply, run
`npm run test:seed:dev:mysql` to exercise the whole batch in real local MySQL and
deliberately roll back. This checks account access, tenant relationships, invoice
balances, billing, histories and idempotency, then compares every table digest
with its original value. Run while the local application is idle; concurrent
application writes can invalidate digest comparisons. It requires an unseeded
workspace with no colliding fixtures, and never commits sample records.
