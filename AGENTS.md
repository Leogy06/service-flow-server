# Service Flow — Engineering Rules

## 1. Project Identity

Service Flow is a multi-tenant SaaS for service management.

Core workflow:
Customer → Service Request → Job(s) → Completion → Invoice → Payment

Priorities:
- Data isolation between organizations.
- Correct business logic and database integrity.
- Secure authentication and authorization.
- Consistent frontend/backend contracts.
- Maintainable, production-ready code.
- Minimal, targeted changes over unnecessary rewrites.

## 2. Technology Stack

### Frontend
- Next.js 16 App Router.
- React and TypeScript.
- Axios for HTTP requests.
- TanStack Query for server state.
- Tailwind CSS and shadcn/ui.
- Zod for applicable client-side validation.
- Sonner for toast notifications.

### Backend
- Node.js, Express, TypeScript.
- Zod for request validation.
- Prisma ORM.
- MySQL database.
- Redis for applicable caching or other explicitly implemented infrastructure.
- REST API architecture.

### Project Rules
- Inspect existing dependencies, scripts, folder structure, and implementation before making changes.
- Do not assume a library, abstraction, endpoint, or utility exists without checking.
- Preserve existing architecture unless change is necessary and justified.
- Do not introduce another state-management library, ORM, validation library, or HTTP client without a concrete reason.
- Keep frontend and backend independently maintainable.
- Do not duplicate business rules across layers when backend enforcement is required.

## 3. Mandatory Workflow Before Changes

Before implementing a feature or fixing a bug:

1. Identify affected frontend components, hooks, API clients, routes, controllers, services, Prisma models, middleware, and permissions.
2. Trace existing execution flow end to end.
3. Identify related business rules and tenant boundaries.
4. Reuse existing project patterns when correct.
5. Make the smallest complete change.
6. Check related call sites, types, tests, and dependent features.
7. Run relevant available checks.
8. Report changes, verification results, and remaining risks.

For cross-layer features, inspect both frontend and backend before deciding on implementation.

Do not blindly edit the first matching file.

## 4. Multi-Tenant Isolation — Critical

Organization is the tenant root.

- Every tenant-owned record must belong to the correct organization through the established data model.
- Every tenant-scoped read, create, update, delete, and nested-resource operation must enforce organization ownership.
- Derive authenticated user's organization from trusted server-side authentication context, not client-supplied organization IDs.
- Never trust organizationId from request bodies, query parameters, route parameters, or frontend state for authorization.
- Scope database queries by organizationId wherever tenant ownership applies.
- Validate ownership of related records before connecting or modifying them.
- Apply tenant isolation to background jobs, exports, search, reporting, caching, and public tracking where applicable.
- Never expose another organization's customers, users, requests, jobs, invoices, payments, or audit logs.
- Return appropriate not-found or authorization responses without leaking cross-tenant record existence.
- Platform-level administrative access must follow explicit privileged authorization rules; never bypass tenant checks implicitly.

For every new endpoint, ask:
"Can a user from Organization A access or modify Organization B's data?"

If yes, implementation is incomplete.

## 5. Authentication and Session Security

Existing authentication design:
- Access token stored in application memory.
- Refresh token stored in an HTTP-only cookie.
- Axios requests use the established credentials configuration.
- Protected application routes use existing authentication context and backend middleware.

Rules:
- Never store access or refresh tokens in localStorage or sessionStorage.
- Never expose refresh tokens to frontend JavaScript.
- Validate access tokens and authenticated user state on the backend.
- Enforce authentication on protected backend endpoints.
- Implement refresh, logout, token expiration, and unauthorized-response handling consistently with existing behavior.
- Prevent duplicate refresh requests and uncontrolled retry loops.
- Clear invalid client authentication state when session recovery fails.
- Do not treat a protected frontend route as a substitute for backend authorization.
- Never log tokens, cookies, passwords, or credentials.
- Preserve working authentication behavior when modifying Axios interceptors, authentication providers, or middleware.

When fixing login issues, trace the entire flow:
Login request → credential verification → token generation → cookie handling → frontend access-token state → authenticated user retrieval → permissions → protected routes.

Do not patch only the visible symptom.

## 6. Roles and Permissions

Existing authorization model:
- Permission: available permission definitions.
- RolePermission: permissions assigned to a role.
- Role: reusable role definition within its intended scope.
- UserPermission: user-specific permission overrides.
- User: assigned role and organization.

Rules:
- Backend authorization is mandatory for protected operations.
- Reuse existing permission constants and permission-checking middleware.
- Follow existing permission naming conventions, such as `customer:read`, when applicable.
- Do not invent alternative permission formats for new endpoints.
- Effective permissions must follow the existing role-permission and user-override resolution logic.
- Inactive permissions must not grant access.
- Distinguish role defaults from user-specific overrides.
- Tenant administrators may manage staff permissions only within their authorized organization and administrative scope.
- Platform super-admin operations must follow explicit platform-level authorization rules.
- Never allow users to grant themselves privileges or modify users outside their authorized scope.
- Protect role assignment, permission changes, account activation, and user promotion as privileged operations.
- Frontend permission checks are for UI behavior only; backend remains authoritative.

When changing permission logic, inspect permission definitions, database relations, middleware, user-loading logic, frontend permission helpers, and existing assignments.

## 7. Business Domain Rules

### Customers
- Preserve existing customer fields and customer-type behavior.
- Support existing individual and organization/group customer requirements.
- Keep customer search, pagination, sorting, and filtering consistent with backend capabilities.
- Validate uniqueness and optional fields according to actual schema and business requirements.
- Enforce tenant ownership on every customer operation.

### Service Requests
- A service request represents the broader service request or case.
- One service request may contain multiple jobs.
- Do not treat a service request and a job as interchangeable.
- Preserve request-to-customer and request-to-job relationships.
- Validate ownership of linked customers and related records.
- Do not silently change request lifecycle behavior when implementing job workflows.

### Jobs
- Jobs represent specific activities under a service request.
- Preserve established job status transitions, including pending, in_progress, and completed.
- Maintain job status history when required by existing implementation.
- Validate status transitions on the backend.
- Do not mark a parent request completed merely because one job is completed unless explicit business rules require it.

### Invoices and Payments
- Calculate invoice totals on the backend from validated invoice line items.
- Never trust frontend-submitted totals as authoritative.
- Validate invoice ownership and related customer or job relationships.
- Payments must not exceed the permitted outstanding invoice balance.
- Handle monetary calculations and rounding consistently.
- Use database transactions for operations that must succeed or fail together.
- Prevent duplicate payment processing and inconsistent invoice balances.
- Preserve existing invoice and payment status rules.

### Audit Logs
- Record security-sensitive and business-critical changes according to existing audit requirements.
- Include appropriate actor, organization, action, target, and timestamp information.
- Never include passwords, tokens, or unnecessary sensitive payloads.
- Do not silently remove audit coverage when refactoring business logic.

### Public Tracking
- Expose only explicitly approved tracking information.
- Never return internal notes, credentials, private customer information, or administrative data.
- Validate tracking identifiers and enforce existing tracking-access rules.
- Avoid leaking record existence or tenant information.

## 8. Backend Architecture and REST APIs

Follow existing backend layering and folder conventions.

- Keep routing, request validation, business logic, database access, and response handling separated according to existing architecture.
- Do not move substantial business logic into route handlers when established services already handle it.
- Validate request bodies, parameters, and query strings with existing Zod patterns.
- Validate IDs, enum values, pagination limits, sorting fields, and relationship ownership.
- Use parameterized ORM operations; never construct unsafe raw SQL from user input.
- Use centralized error handling and established response formats.
- Do not expose stack traces, SQL errors, internal paths, or secrets in production responses.
- Avoid duplicated authorization and business logic across endpoints.
- Keep API contracts compatible with existing frontend consumers.
- If a contract must change, update every affected consumer and related type.
- Apply transactions when multiple database changes must remain consistent.
- Avoid N+1 queries and unnecessarily broad database reads.
- Do not silently swallow exceptions or return success after failed operations.

## 9. Database and Prisma

- Inspect the current Prisma schema and generated client before changing models.
- Treat schema changes as changes to application behavior, not isolated edits.
- Use proper relations, foreign keys, unique constraints, indexes, and nullability.
- Add indexes based on real query patterns and integrity requirements.
- Preserve organization-scoped uniqueness rules where applicable.
- Use transactions for multi-step operations that require atomicity.
- Follow the project's established soft-delete behavior.
- Ensure soft-deleted records are handled consistently in reads, updates, uniqueness checks, and related workflows.
- Create and review migrations for schema changes.
- Never edit an already-applied migration to repair a new change.
- Never reset, drop, or wipe databases without explicit approval.
- Do not run destructive production operations.
- Regenerate the Prisma client using existing project scripts after relevant schema changes.
- Check existing seed scripts and constraints before modifying seed data.
- Preserve existing Prisma adapter and database configuration.

## 10. Frontend Architecture and Data Flow

- Follow existing Next.js App Router and feature-folder conventions.
- Reuse existing UI components, form patterns, API clients, and shared utilities.
- Use Axios for API communication and TanStack Query for server-state management.
- Keep server state separate from local UI state.
- Use existing Zod and form-validation patterns.
- Handle loading, empty, error, success, and disabled states.
- Invalidate or update relevant TanStack Query caches after mutations.
- Prevent stale data from appearing after organization changes, logout, or permission changes.
- Handle expired sessions consistently with authentication infrastructure.
- Hide unavailable actions based on effective permissions, but never rely on hidden UI for security.
- Keep API response types aligned with actual backend contracts.
- Avoid unnecessary `any`, unsafe type assertions, duplicated types, and excessive component complexity.
- Preserve responsive layouts and existing design-system conventions.
- Do not add dependencies to solve problems already covered by existing utilities.

## 11. Validation and Error Handling

- Backend validation is authoritative.
- Frontend validation improves usability but does not replace server validation.
- Reuse established Zod schemas where appropriate.
- Keep validation messages useful and safe.
- Distinguish validation errors, authentication failures, authorization failures, missing records, conflicts, and unexpected server errors.
- Do not return success when a database operation fails.
- Prevent duplicate submissions where they could create duplicate records or payments.
- Handle network failures and expired sessions without infinite retries.
- Never suppress errors merely to make UI appear successful.

## 12. Testing and Verification

Before claiming a change is complete:

- Run relevant existing lint, type-check, test, and build commands when available.
- Inspect available package scripts before inventing commands.
- Add or update tests for changed business rules when an appropriate test setup exists.
- Prioritize tenant isolation, permission enforcement, authentication, relationship ownership, state transitions, invoice totals, and payment limits.
- Test failure paths and unauthorized access, not only successful requests.
- Verify frontend behavior against actual backend response shapes.
- Check regression risks for related features.

If checks cannot run, state exactly which checks were not run and why.

Never claim tests passed unless they actually ran successfully.

Do not introduce a new testing framework or infrastructure without justification.

## 13. Security and Sensitive Configuration

- Never hardcode secrets, API keys, passwords, or production credentials.
- Never commit environment files containing secrets.
- Use existing environment-variable conventions.
- Validate required environment configuration at startup where the project supports it.
- Redact sensitive data from logs.
- Apply least privilege to administrative operations.
- Protect against cross-tenant access, privilege escalation, injection, mass assignment, and unsafe file or data exports.
- Review new dependencies and avoid unnecessary packages.
- Do not disable security checks to make implementation easier.

## 14. Code Quality and Change Scope

- Prefer clear, explicit TypeScript and existing project conventions.
- Reuse established abstractions when they fit the problem.
- Avoid speculative abstractions and premature generalization.
- Avoid unnecessary rewrites, unrelated refactors, and formatting churn.
- Do not duplicate existing utilities or create parallel implementations.
- Remove dead code only when relevant to the requested change.
- Preserve compatibility unless a breaking change is intentional and approved.
- Do not silently change established business rules.
- Ask before destructive changes or decisions that materially alter architecture, security, or data integrity.
- If requirements are ambiguous, inspect existing behavior first and ask only when ambiguity materially affects correctness.

## 15. Completion Report

After completing a task, report:

1. What changed.
2. Which frontend and backend areas were affected.
3. Any database, migration, API contract, or permission changes.
4. Checks and tests actually executed, with results.
5. Known limitations, unverified behavior, and remaining risks.

Keep reports concise and factual.

### Rate Limit Rules
1. Always fill in the **Rate limit** field, even when the answer is "None hit".
2. If you hit a rate limit, **stop and log it**. Do not keep retrying in a loop.
3. Retry at most **3 times** with exponential backoff (e.g. 5s, 15s, 45s). If it still fails, set Status to `Rate-limited`.
4. Record exactly where you stopped (file, step, or command) so the next agent can resume without redoing work.
5. Never leave files half-edited when stopping. Finish the current edit or revert it, and say which in the notes.
6. If a reset time is provided by the API or tool (e.g. `Retry-After` header), record it in **Resets at**.
7. At the start of work, if the latest entry says `Rate-limited` and the reset time hasn't passed, tell the user instead of starting heavy work.
8. Prefer fewer, larger operations over many small ones to avoid burning through limits (batch reads, avoid redundant searches).

### General Rules
1. Never skip the log entry, even if no files were changed. Record what was investigated.
2. Never delete or rewrite earlier entries. Only add new ones.
3. Keep entries short and factual (3-8 lines). No fluff.
4. Be honest about the status. If something is unfinished, broken, or untested, say so.
5. Use the current date and time. Don't guess or reuse an old timestamp.
6. If you made a decision that isn't obvious from the code, explain why in the notes.


## API Rate Limiting (Required)

Every API endpoint that is created or modified must be protected by rate limiting, applied **at the middleware level**, not inside individual handlers.

### Rules
1. **Use middleware.** Register rate limiting as shared middleware (global default plus per-route overrides). Never copy-paste limiter logic into route handlers.
2. **Check every new endpoint.** When adding or changing a route, confirm it is covered by a limiter. If it isn't, add one before finishing.
3. **Stricter limits for sensitive and write operations.** Suggested starting points (adjust to the project):

| Endpoint type | Example limit | Key by |
|---|---|---|
| Login / authentication | 5 per minute | IP + username/email |
| Signup, password reset, OTP/verification | 3 to 5 per 10 minutes | IP + email/phone |
| POST / PUT / PATCH / DELETE (writes) | 30 per minute | User ID (fallback: IP) |
| Authenticated reads (GET) | 100 per minute | User ID |
| Public / unauthenticated reads | 60 per minute | IP |
| File uploads, exports, expensive queries | 5 to 10 per minute | User ID |

4. **Key correctly.** Use user ID for authenticated routes and IP for anonymous ones. Respect the real client IP behind proxies (`X-Forwarded-For`) only if the proxy is trusted.
5. **Return proper responses.** On limit exceeded, respond with `429 Too Many Requests` and include `Retry-After` (and `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` if supported).
6. **Use a shared store in production.** Use Redis (or equivalent) so limits work across multiple instances. In-memory limiters are for local development only.
7. **Never exempt silently.** Health checks and internal webhooks may be exempted, but each exemption must be commented with the reason. Webhooks should be verified by signature instead.
8. **Don't weaken existing limits.** Never raise or remove a limit to make a test pass. Ask first, or mock the limiter in tests.
9. **Make limits configurable.** Put values in config or environment variables, not hardcoded in routes.
10. **Log it.** In your `ACTIVITY.md` entry, note which endpoints were added or changed and which limiter covers them.

### Checklist before finishing
- [ ] Every new or changed route goes through the rate-limit middleware
- [ ] Auth and write endpoints have stricter limits than reads
- [ ] 429 responses include `Retry-After`
- [ ] Limits come from config, not hardcoded values
- [ ] Tests cover the 429 case for any new sensitive endpoint


## Activity Footprint (Required)

Every agent must leave a footprint of its latest activity **every single time** it works in this repo, no exceptions, even for small changes.

### Where
Log to `ACTIVITY.md` in the repository root. Create it if it doesn't exist.

### When
- **Start of work:** Read the top entries of `ACTIVITY.md` to understand what was done last and what is pending.
- **End of work:** Add a new entry before finishing, even if the task was only partly completed or failed.

### Format
Add new entries at the **top** of the file (newest first), using this template:

```markdown
## [YYYY-MM-DD HH:MM] <agent or tool name>

- **Task:** What was requested, in one line
- **Summary:** What was actually done
- **Files changed:** `path/to/file1`, `path/to/file2`
- **Status:** Completed | Partial | Blocked | Failed
- **Next steps / Notes:** Anything the next agent or person should know
```

### Rules
1. Never skip the log entry, even if no files were changed. Record what was investigated.
2. Never delete or rewrite earlier entries. Only add new ones.
3. Keep entries short and factual (3-6 lines). No fluff.
4. Be honest about the status. If something is unfinished, broken, or untested, say so.
5. Use the current date and time. Don't guess or reuse an old timestamp.
6. If you made a decision that isn't obvious from the code, explain why in the notes.