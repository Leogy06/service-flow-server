# Service Flow — Engineering Rules

Read and follow `../AGENTS.md` first, including its engineering, commenting, testing, and communication standards. This file adds backend conventions; keep new universal rules in the root file.

These rules apply to every agent and contributor working in this repository.
If a feature folder contains its own `FEATURE.md` or `AGENTS.md`, read it too. Where the two conflict, the more specific file wins, except for sections 4 (Tenant Isolation), 5 (Authentication), and 6 (Permissions), which are never overridden.

## 1. Project Identity

Service Flow is a multi-tenant SaaS for service management.

Core workflow: Customer → Service Request → Job(s) → Completion → Invoice → Payment

Priorities, in order:
1. Data isolation between organizations.
2. Secure authentication and authorization.
3. Correct business logic and database integrity.
4. Consistent frontend/backend contracts.
5. Maintainable, production-ready code with minimal, targeted changes.

## 2. Technology Stack

**Frontend:** Next.js 16 (App Router), React, TypeScript, Axios, TanStack Query, Tailwind CSS, shadcn/ui, Zod (client validation), Sonner (toasts).

**Backend:** Node.js, Express, TypeScript, Zod (request validation), Prisma ORM, MySQL, Redis (only where explicitly implemented), REST API.

**Stack rules:**
- Inspect existing dependencies, scripts, folder structure, and implementation before changing anything.
- Never assume a library, abstraction, endpoint, or utility exists. Verify it.
- Preserve the existing architecture unless a change is necessary and justified.
- Do not add another state-management library, ORM, validation library, or HTTP client without a concrete reason.
- Keep frontend and backend independently maintainable.
- Do not duplicate business rules across layers where backend enforcement is required.

## 3. Mandatory Workflow Before Changes

Before implementing a feature or fixing a bug:

1. Read the latest entries of `ACTIVITY.md` (see section 17).
2. Identify affected frontend components, hooks, API clients, routes, controllers, services, Prisma models, middleware, and permissions.
3. Trace the existing execution flow end to end. Do not blindly edit the first matching file.
4. Identify related business rules and tenant boundaries.
5. Reuse existing project patterns when they are correct.
6. Make the smallest complete change.
7. Check related call sites, types, tests, and dependent features.
8. Run relevant available checks.
9. Report changes, verification results, and remaining risks (section 18).

For cross-layer features, inspect both frontend and backend before deciding on an implementation.

## 4. Multi-Tenant Isolation (Critical)

The organization is the tenant root.

- Every tenant-owned record must belong to the correct organization through the established data model.
- Every tenant-scoped read, create, update, delete, and nested-resource operation must enforce organization ownership.
- Derive the user's organization from trusted server-side authentication context. **Never** trust `organizationId` from request bodies, query parameters, route parameters, or frontend state.
- Scope database queries by `organizationId` wherever tenant ownership applies.
- Validate ownership of related records before connecting or modifying them.
- Apply tenant isolation to background jobs, exports, search, reporting, caching, and public tracking.
- Never expose another organization's customers, users, requests, jobs, invoices, payments, or audit logs.
- Return not-found or authorization responses that do not reveal whether a cross-tenant record exists.
- Platform-level admin access must follow explicit privileged authorization rules. Never bypass tenant checks implicitly.

For every new or changed endpoint, ask: **"Can a user from Organization A access or modify Organization B's data?"** If yes, the implementation is incomplete.

## 5. Authentication and Session Security

**Existing design:**
- Access token is stored in application memory.
- Refresh token is stored in an HTTP-only cookie.
- Axios requests use the established credentials configuration.
- Protected routes use the existing authentication context and backend middleware.

**Rules:**
- Never store access or refresh tokens in `localStorage` or `sessionStorage`.
- Never expose refresh tokens to frontend JavaScript.
- Validate access tokens and authenticated user state on the backend, and enforce authentication on every protected endpoint.
- A protected frontend route is never a substitute for backend authorization.
- Handle refresh, logout, token expiry, and unauthorized responses consistently with existing behavior.
- Prevent duplicate refresh requests and uncontrolled retry loops.
- Clear invalid client auth state when session recovery fails.
- Never log tokens, cookies, passwords, or credentials.
- Preserve working authentication behavior when modifying Axios interceptors, auth providers, or middleware.

When fixing login issues, trace the whole flow, not just the visible symptom:
Login request → credential verification → token generation → cookie handling → frontend access-token state → authenticated user retrieval → permissions → protected routes.

## 6. Roles and Permissions

**Existing model:**
- `Permission`: available permission definitions.
- `RolePermission`: permissions assigned to a role.
- `Role`: reusable role definition within its intended scope.
- `UserPermission`: user-specific permission overrides.
- `User`: assigned role and organization.

**Rules:**
- Backend authorization is mandatory and authoritative. Frontend permission checks are for UI behavior only.
- Reuse existing permission constants and permission-checking middleware.
- Follow existing naming conventions (e.g. `customer:read`). Do not invent alternative formats.
- Effective permissions must follow the existing role-permission and user-override resolution logic.
- Inactive permissions must not grant access.
- Distinguish role defaults from user-specific overrides.
- Tenant admins may manage staff permissions only within their own organization and administrative scope.
- Platform super-admin operations must follow explicit platform-level authorization rules.
- Never allow users to grant themselves privileges or modify users outside their authorized scope.
- Treat role assignment, permission changes, account activation, and user promotion as privileged operations.

When changing permission logic, inspect permission definitions, database relations, middleware, user-loading logic, frontend permission helpers, and existing assignments.

## 7. Business Domain Rules

### Customers
- Preserve existing customer fields and customer-type behavior (individual and organization/group).
- Keep search, pagination, sorting, and filtering consistent with backend capabilities.
- Validate uniqueness and optional fields against the actual schema and business requirements.
- Enforce tenant ownership on every customer operation.

### Service Requests
- A service request is the broader case. One request may contain multiple jobs.
- Never treat a service request and a job as interchangeable.
- Preserve request-to-customer and request-to-job relationships, and validate ownership of linked records.
- Do not silently change request lifecycle behavior when implementing job workflows.

### Jobs
- A job is a specific activity under a service request.
- Preserve established status transitions (`pending`, `in_progress`, `completed`) and status history where it exists.
- Validate status transitions on the backend.
- Do not mark a parent request completed because one job completed, unless explicit business rules require it.

### Invoices and Payments
- Calculate invoice totals on the backend from validated line items. Never trust frontend-submitted totals.
- Validate invoice ownership and related customer or job relationships.
- Payments must not exceed the outstanding invoice balance.
- Handle monetary calculations and rounding consistently.
- Use database transactions for operations that must succeed or fail together.
- Prevent duplicate payment processing and inconsistent invoice balances.
- Preserve existing invoice and payment status rules.

### Audit Logs
- Record security-sensitive and business-critical changes per existing audit requirements.
- Include actor, organization, action, target, and timestamp.
- Never include passwords, tokens, or unnecessary sensitive payloads.
- Do not silently remove audit coverage when refactoring.

### Public Tracking
- Expose only explicitly approved tracking information.
- Never return internal notes, credentials, private customer information, or admin data.
- Validate tracking identifiers and enforce existing access rules.
- Do not leak record existence or tenant information.

## 8. Backend Architecture and REST APIs

- Follow the existing route, controller, service, repository (where present), and middleware conventions. Keep controllers thin and business logic in services.
- Validate and sanitize untrusted inputs at system boundaries using consistent TypeScript types and Zod schemas. Centralize authentication, authorization, error handling, and logging through existing infrastructure.
- Use Redis caching only where appropriate and explicitly implemented; invalidate affected cache entries after updates or deletions and preserve tenant boundaries in cache keys.
- Follow existing layering and folder conventions. Keep routing, validation, business logic, database access, and response handling separated.
- Do not move substantial business logic into route handlers when services already handle it.
- Validate bodies, params, and query strings with existing Zod patterns, including IDs, enums, pagination limits, sort fields, and relationship ownership.
- Use parameterized ORM operations. Never build raw SQL from user input.
- Use centralized error handling and established response formats.
- Never expose stack traces, SQL errors, internal paths, or secrets in production responses.
- Avoid duplicated authorization and business logic across endpoints.
- Keep API contracts compatible with existing frontend consumers. If a contract must change, update every consumer and related type.
- Use transactions when multiple database changes must stay consistent.
- Avoid N+1 queries and unnecessarily broad reads.
- Never swallow exceptions or return success after a failed operation.

## 9. Database and Prisma

- Inspect the current Prisma schema and generated client before changing models.
- Treat schema changes as application behavior changes, not isolated edits.
- Use proper relations, foreign keys, unique constraints, indexes, and nullability. Base indexes on real query patterns.
- Preserve organization-scoped uniqueness rules.
- Use transactions for multi-step atomic operations.
- Follow the established soft-delete behavior consistently in reads, updates, uniqueness checks, and related workflows.
- Create and review migrations for every schema change.
- **Never** edit an already-applied migration to fix a new change.
- **Never** reset, drop, or wipe a database, or run destructive production operations, without explicit approval.
- Regenerate the Prisma client with existing project scripts after schema changes.
- Check seed scripts and constraints before modifying seed data.
- Preserve the existing Prisma adapter and database configuration.

## 10. Frontend Architecture and Data Flow

- Follow existing Next.js App Router and feature-folder conventions.
- Use Axios for API calls and TanStack Query for server state. Keep server state separate from local UI state.
- Use existing Zod and form-validation patterns.
- Handle loading, empty, error, success, and disabled states.
- Invalidate or update relevant query caches after mutations.
- Prevent stale data after organization changes, logout, or permission changes.
- Handle expired sessions consistently with the authentication infrastructure.
- Hide unavailable actions based on effective permissions, but never rely on hidden UI for security.
- Keep API response types aligned with actual backend contracts.
- Avoid unnecessary `any`, unsafe type assertions, duplicated types, and overly complex components.
- Preserve responsive layouts and design-system conventions.
- Do not add dependencies for problems existing utilities already solve.

### Shared Components and Reusability
- Before creating any UI component, inspect `components/shared` and existing feature components.
- Prefer existing shared components over creating duplicates. Never duplicate tables, dialogs, form fields, pagination controls, or other reusable patterns.
- Put components used by multiple features in `components/shared`. Keep feature-specific components in their feature folder.
- Extract repeated UI patterns into shared components only when reuse is justified. Do not abstract components used once.
- Shared components must be customizable through well-typed props.
- Preserve existing component APIs and styling when extending shared components, and check all consumers for regressions.
- Use existing shadcn/ui primitives and design tokens instead of rebuilding them.

## 11. Validation and Error Handling

- Backend validation is authoritative. Frontend validation improves usability only.
- Reuse established Zod schemas where appropriate. Keep messages useful and safe.
- Distinguish validation errors, authentication failures, authorization failures, missing records, conflicts, and unexpected server errors.
- Prevent duplicate submissions that could create duplicate records or payments.
- Handle network failures and expired sessions without infinite retries.
- Never suppress errors just to make the UI look successful.

## 12. API Rate Limiting

Every API endpoint that is created or modified must be covered by rate limiting applied **at the middleware level**, never copy-pasted into route handlers.

1. First inspect the existing middleware and dependencies. Reuse the current limiter. If none exists, propose one before adding a new package.
2. Register a global default limiter plus stricter per-route overrides.
3. When adding or changing a route, confirm a limiter covers it before finishing.
4. Suggested starting limits (adjust to the project, and keep them in config or environment variables, not hardcoded):

| Endpoint type | Example limit | Key by |
|---|---|---|
| Login / authentication | 5 per minute | IP + email/username |
| Signup, password reset, OTP | 3–5 per 10 minutes | IP + email/phone |
| POST / PUT / PATCH / DELETE | 30 per minute | User ID (fallback: IP) |
| Authenticated GET | 100 per minute | User ID |
| Public / unauthenticated GET (including public tracking) | 60 per minute | IP |
| Uploads, exports, expensive queries | 5–10 per minute | User ID |

5. Respond with `429 Too Many Requests` and a `Retry-After` header (plus `X-RateLimit-*` headers if supported), using the established error format.
6. Use a shared store (Redis) in production so limits work across instances. In-memory limiters are for local development only.
7. Trust `X-Forwarded-For` only when the proxy is trusted, so clients cannot spoof their IP.
8. Exemptions (health checks, signed webhooks) must be commented with the reason. Verify webhooks by signature.
9. Never weaken, raise, or remove a limit to make a test pass. Ask first, or mock the limiter in tests.
10. Add tests for the 429 case on new sensitive endpoints.

**Checklist before finishing any endpoint work:**
- [ ] Every new or changed route goes through the rate-limit middleware
- [ ] Auth and write endpoints have stricter limits than reads
- [ ] 429 responses include `Retry-After`
- [ ] Limits come from config, not hardcoded values
- [ ] Tests cover the 429 case for any new sensitive endpoint
- [ ] The `ACTIVITY.md` entry lists the endpoints touched and the limiter applied

## 13. Testing and Verification

Before claiming a change is complete:

- Inspect `package.json` scripts, then run relevant existing lint, type-check, test, and build commands. Do not invent commands.
- Add or update tests for changed business rules when a suitable test setup exists.
- Prioritize tenant isolation, permission enforcement, authentication, relationship ownership, state transitions, invoice totals, and payment limits.
- Test failure paths and unauthorized access, not only success paths.
- Verify frontend behavior against actual backend response shapes.
- Check regression risks in related features.
- Do not introduce a new testing framework without justification.

If checks cannot run, state exactly which ones were skipped and why. **Never claim tests passed unless they actually ran successfully.**

## 14. Security and Sensitive Configuration

- Never hardcode secrets, API keys, passwords, or production credentials.
- Never commit environment files containing secrets. Use existing environment-variable conventions.
- Validate required environment configuration at startup where supported.
- Redact sensitive data from logs.
- Apply least privilege to administrative operations.
- Protect against cross-tenant access, privilege escalation, injection, mass assignment, and unsafe file or data exports.
- Review new dependencies and avoid unnecessary packages.
- Never disable security checks to make an implementation easier.

## 15. Code Quality and Change Scope

- Prefer clear, explicit TypeScript and existing project conventions.
- Reuse established abstractions. Avoid speculative abstractions and premature generalization.
- Avoid unnecessary rewrites, unrelated refactors, and formatting churn.
- Do not duplicate existing utilities or create parallel implementations.
- Remove dead code only when relevant to the requested change.
- Preserve compatibility unless a breaking change is intentional and approved.
- Do not silently change established business rules.
- Ask before destructive changes or decisions that materially affect architecture, security, or data integrity.
- If requirements are ambiguous, inspect existing behavior first. Ask only when the ambiguity materially affects correctness.

## 16. Feature Docs

Features may have a `FEATURE.md` (or nested `AGENTS.md`) in their folder describing purpose, scope, key files, business rules, and known gotchas.

1. Before editing code in a feature folder, read its doc if one exists.
2. If a feature has no doc and your change is non-trivial, create one before finishing. Keep it under about one page and include: Purpose, Scope, Key files, Rules and considerations, Known gotchas.
3. If your change alters behavior, rules, or file structure, update the doc in the same change.
4. Never contradict a feature doc without telling the user why.

## 17. Activity Footprint (Required)

Every agent must leave a footprint of its latest activity **every single time** it works in this repo, even for small changes or when no files were modified.

**Where:** `ACTIVITY.md` in the repository root. Create it if it does not exist.

**When:**
- **Start of work:** Read the top entries to learn what was done last, what is pending, and whether the previous agent was rate-limited.
- **End of work:** Add a new entry, even if the task was partial, blocked, or failed.
- **If you are stopped by a limit:** Write the entry immediately, before stopping.

**Format:** Add new entries at the **top** (newest first):

```markdown
## [YYYY-MM-DD HH:MM] <agent or tool name>

- **Task:** What was requested, in one line
- **Summary:** What was actually done
- **Files changed:** `path/to/file1`, `path/to/file2`
- **Endpoints / rate limiting:** Routes added or changed and the limiter applied (or "N/A")
- **Status:** Completed | Partial | Blocked | Failed | Rate-limited
- **Agent rate limit:** None hit | Hit (which limit) | Near limit (~% used)
- **Resets at:** YYYY-MM-DD HH:MM (or "unknown")
- **Next steps / Notes:** Anything the next agent or person should know
```

**Rules:**
1. Never skip the entry. If no files changed, record what was investigated.
2. Never delete or rewrite earlier entries. Only add new ones.
3. Keep entries short and factual (3–8 lines).
4. Be honest about status. If something is unfinished, broken, or untested, say so.
5. Use the real current date and time. Do not guess or reuse an old timestamp.
6. Explain non-obvious decisions in the notes.

**When the agent itself hits a rate limit (API or tool):**
1. Stop and log it. Do not retry in an endless loop.
2. Retry at most 3 times with exponential backoff (e.g. 5s, 15s, 45s). If it still fails, set Status to `Rate-limited`.
3. Record exactly where you stopped (file, step, or command) so the next agent can resume without redoing work.
4. Never leave files half-edited. Finish or revert the current edit, and say which in the notes.
5. Record the reset time if the API provides one (e.g. `Retry-After`).
6. If the latest entry is `Rate-limited` and its reset time has not passed, tell the user before starting heavy work.
7. Prefer fewer, larger operations (batch reads, avoid redundant searches).

## 18. Completion Report

After completing a task, report concisely and factually:

1. What changed.
2. Which frontend and backend areas were affected.
3. Any database, migration, API contract, rate-limit, or permission changes.
4. Checks and tests actually executed, with results.
5. Known limitations, unverified behavior, and remaining risks.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
