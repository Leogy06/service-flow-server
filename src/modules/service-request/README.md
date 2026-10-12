# Service request management

All endpoints are mounted at `/api/service-requests` behind `authenticate`.
Tenant ownership comes from the authenticated request context. Body and query
organization IDs never grant access.

| Endpoint | Permission | Result |
| --- | --- | --- |
| `GET /` | `service_request:read` | `{ requests, pagination }` |
| `GET /:id` | `service_request:read` | Request, jobs, activity, allowed transitions |
| `POST /` | `service_request:create` | New pending request with backend reference |
| `PUT /:id` | `service_request:update` | Updated request details |
| `PATCH /:id/status` | `service_request:update` | Validated status change |
| `GET /customers` | `service_request:create` | Paginated active customer IDs and names |
| `GET /types` | `service_request:read` | Paginated service types |
| `POST /types` | `service_request:create` | New organization service type |
| `PUT /types/:id` | `service_request:update` | Updated service type |
| `DELETE /types/:id` | `service_request:delete` | Archive by setting `isActive=false` |

Request list query: `page`, `pageSize` (1–100), `search` (reference or customer),
`status`, `serviceTypeId`, `sortBy=createdAt`, and `sortOrder=asc|desc`.
Type list query: `page`, `pageSize`, `search`, and `active=all|active|archived`.
Responses use the existing `{ data, ... }` response envelope.

Lifecycle:

- `PENDING → IN_PROGRESS | CANCELLED`
- `IN_PROGRESS → COMPLETED | CANCELLED`
- Completed and cancelled requests are terminal and cannot be edited.
- Completion requires at least one related job and every job `COMPLETED`.
- Cancellation requires every related job `COMPLETED` or `CANCELLED`.
- Linking jobs does not automatically complete a request. Customer and type cannot
  change once jobs are linked. The edit UI keeps those relationships fixed.
- Archived types remain attached to historical requests but cannot be newly selected.

Ownership checks, lifecycle changes, and audit writes execute in serializable
transactions with bounded conflict retries. Audit failures roll back mutations.
The request API omits public tracking tokens and job internal notes.
The Job module checks the parent request lifecycle before creating, editing or
changing jobs. Starting a job advances a pending request to `IN_PROGRESS`, with
an audit entry; completing jobs leaves request completion explicit.
The linked Jobs and Billing workflow is documented in
`frontend/features/workflow/README.md`.

Verification commands from `backend/`:

```text
npm test -- --runInBand
npm run test:service-requests:mysql
npm run test:service-requests:browser
```

The opt-in integration scripts use configured local MySQL and Redis and remove only
their temporary UUID-scoped organizations and related fixtures. Browser verification
uses the existing headless Edge harness and a private fixture session adapter; it
does not change production authentication. Apply the migration and regenerate Prisma
before running integration checks against another environment.
