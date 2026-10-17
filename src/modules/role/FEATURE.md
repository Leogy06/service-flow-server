# Tenant roles and access policy

Role routes/schema/controller/service and `tenant-access-policy.ts` manage role
defaults within a tenant administrator's grantable authority. Reserved/self roles,
out-of-scope grants and assigned-role deletion are protected. Role defaults and
user-specific overrides remain separate; archive/restore retains defaults.

Only assignable-role dropdowns are cached. Persisted administrator checks run
before every lookup, and the cache varies by actor authority and role. Role lists,
role/permission details and all authorization/assignment checks stay live.
`accessTransaction` invalidates dependent user lists, role choices, staff/job
projections, eligible plans and dashboard only after commit. See
`backend/docs/CACHING.md`; tests are under `tests/access-management` and
`tests/cache`.
