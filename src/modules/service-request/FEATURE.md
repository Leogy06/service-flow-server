# Service requests and service types

Routes, schema, controller, `service-request.service.ts` and `lifecycle.ts` manage
tenant cases and their service-type catalog. Requests own multiple jobs. Linked
customers/types must belong to the tenant; closed requests cannot be edited.
Changing a request's customer/type after jobs exist is prohibited. Completion and
cancellation follow backend lifecycle rules and transactional audits.

Lists/details, customer choices and service types use shared Redis caching.
Request writes invalidate requests, related job projections and dashboard;
service-type writes also refresh service-type choices and embedded names/prices.
Customer and job mutations invalidate their dependent request views after commit.
Validation queries stay live. See `backend/docs/CACHING.md`; tests are under
`tests/service-request` and `tests/cache`.
