# Jobs

`job.routes.ts`, schema, controller, service and `lifecycle.ts` manage activities
under tenant service requests. Staff must be active tenant members. Status changes
preserve history and transactional audits. Starting the first job starts a pending
parent request; completing a job does not complete its parent automatically.

List/detail, filter metadata and staff-choice reads use shared Redis caching.
Keys include the viewer so `mine` results cannot cross staff accounts. Job changes
invalidate jobs, parent request projections and dashboard after commit. Customer,
service-type, user/role, request and invoice mutations refresh dependent job views,
including billable filters. Validation reads stay live. See
`backend/docs/CACHING.md`; tests are under `tests/workflow` and `tests/cache`.
