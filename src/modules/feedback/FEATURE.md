# Feedback

Demo organizations cannot create customer feedback invitations or submit product
feedback. Existing demo public links return the generic unavailable-link response,
and testimonial approval rejects demo content. Private customer feedback workflows
remain readable. Mode comes from persisted organization data at the service boundary.

Private feedback about Service Flow and customer feedback about tenant services
use separate tables and inboxes. `feedback.service.ts` enforces ownership and
transactions; schemas, controllers and routes follow existing API conventions.

The three authenticated list responses include additive `stats` with `total`,
`averageRating` (one decimal, null when empty), `byStatus` (NEW/IN_REVIEW/RESOLVED)
and `approvedTestimonials`. Database group/count aggregates cover the full viewer
scope in the list transaction, independently of list filters or pagination. Tenant
customer stats use only that organization; own product stats require both author
and organization; platform product stats require persisted platform authority.
Approved totals require active publication consent and approval. Public context
and submission responses never expose these statistics. Existing routes/limiters,
permissions and schema remain unchanged for this addition.

- Any authenticated tenant user can submit product feedback, list only their own
  submissions and withdraw their own publication consent. Only persisted platform
  administrators can review the product inbox. Customer feedback is tenant scoped
  and requires `feedback:read`, `feedback:create` (invitations), or
  `feedback:update` (review); review also requires read permission.
- Invitations require an active tenant, an unarchived customer and a COMPLETED
  request whose jobs are all completed. Generating another link replaces the old
  one until a response exists. Only one response is allowed per request.
- Invitation tokens have 256 bits of randomness, are stored hashed, and travel in
  the frontend URL fragment and API POST body, never URL paths/query strings.
  Expiry defaults to 30 days. Submitted links remain usable only for consent
  withdrawal after expiry. Public responses omit customer identity, request
  details, feedback text and internal notes. No invitations are emailed automatically.
- Feedback starts private. Publication consent is optional, versioned, server
  timestamped and requires a user-chosen display name. Explicit reviewer approval
  is separate. Withdrawal clears approval atomically. Customer link withdrawal
  works even for inactive tenants; product withdrawal requires the author's valid
  tenant session. Original feedback is never edited by reviewers.
  There are no public testimonial feeds in this release; a ready filter supports
  manual selection. Removing externally published copies requires manual follow-up.
- Mutations and audits commit together. Product submission keys and invitation
  uniqueness prevent duplicate responses. Audits omit comments and tokens.
- Private routes use the per-user API limiter after authentication, and writes
  use the shared per-user write limiter. Public context/submit/withdraw use the
  strict IP `feedbackLimiter`; public writes additionally retain their separate
  30/hour IP `publicWriteLimiter`. Both public budgets fail closed on Redis errors.
- Deploy the additive feedback migration and regenerate Prisma before use.
  Existing tenant Admin roles receive the new grants; Managers/Staff/custom
  roles retain their assignments. New Admin/Manager defaults include feedback;
  Staff require explicit delegation. No existing grants are overwritten.

Verification: `npm test -- --runInBand tests/feedback`, and
`npm run test:feedback:mysql:isolated` with an explicit isolated
`PLATFORM_TEST_DATABASE_NAME`. The MySQL runner never drops/resets databases and
retains audit fixtures. Configuration: `FEEDBACK_RATE_LIMIT_WINDOW_MS` (600000),
`FEEDBACK_RATE_LIMIT_MAX` (20), `FEEDBACK_INVITATION_DAYS` (30, allowed 1–90).
