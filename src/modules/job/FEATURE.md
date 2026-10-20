# Jobs

`job.routes.ts`, schema, controller, service and `lifecycle.ts` manage activities
under tenant service requests. Staff must be active tenant members. Status changes
preserve history and transactional audits. Starting the first job starts a pending
parent request; completing a job does not complete its parent automatically.

Create, reassignment/rescheduling and starting work check live staff availability
inside the write's serializable transaction. An occupied staff member or overlapping
ASSIGNED schedule returns 409 `JOB_STAFF_CONFLICT` without writing anything.
The caller may explicitly retry with boolean `overrideStaffConflict: true` using
the same create/update permission. Actual overrides and conflicting job IDs are
included in the transactional audit, never persisted as a job setting. Warning
responses contain availability information only, not other jobs or customer data.
COMPLETED/CANCELLED jobs and the edited job are excluded. Schedule intervals are
half-open (touching endpoints are allowed); missing end times are open-ended.
Unscheduled queued jobs have no scheduled overlap, but still warn about another
IN_PROGRESS job, including one past its planned end. Starting work checks from
the current time to the planned end, or open-ended if that end is absent/elapsed.
Unchanged assignment/date fields and notes-only edits do not re-prompt. Omitted
text fields in updates remain omitted; defaults apply only on creation.
See `tests/workflow/staff-conflicts.test.ts` for API, tenant, permission and audit
failure coverage; actual database concurrency still needs MySQL verification.

List/detail, filter metadata and staff-choice reads use shared Redis caching.
Keys include the viewer so `mine` results cannot cross staff accounts. Job changes
invalidate jobs, parent request projections and dashboard after commit. Customer,
service-type, user/role, request and invoice mutations refresh dependent job views,
including billable filters. Validation reads stay live. See
`backend/docs/CACHING.md`; tests are under `tests/workflow` and `tests/cache`.
