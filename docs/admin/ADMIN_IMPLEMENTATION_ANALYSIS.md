# Flowdesk Admin Implementation Analysis

## Scope

This document captures the real repository audit for the Flowdesk web app before any administrative layer is implemented. It exists to prevent duplicated systems, preserve the current Flowdesk UX language, and define exactly how the admin panel, RBAC, audit trail, FLWIP, and test-variable platform should be added.

## Audit Timestamp

- Workspace root: `d:\Tools\Xampp\htdocs\Flowdesk\Fl0wD3sk_845983_wjcwf0328roifldvn_934320fn02rg0g89`
- Audit date: `2026-05-02`
- Git note: dirty worktree already exists in `package-lock.json`

## How The Project Works

### Stack

- Framework: Next.js `16.2.3`
- React: `19.2.4`
- TypeScript: strict mode enabled in `tsconfig.json`
- Styling: Tailwind CSS `4` via `@import "tailwindcss"` in `app/globals.css`
- Motion: `motion`, `@studio-freight/lenis`, `@studio-freight/react-lenis`
- Icons: `lucide-react`
- Data/backend SDK: `@supabase/supabase-js` `2.99.2`
- Payments: Mercado Pago
- Domains: OpenProvider
- AI/runtime: custom FlowAI module with OpenAI-compatible provider configuration
- Email: `nodemailer`

### App Router And Routing Strategy

- The app uses the Next.js App Router.
- Route areas are split by public path plus host-aware rewrites handled in `proxy.ts`.
- Current first-party host model:
  - `www.flwdesk.com` -> public site
  - `account.flwdesk.com` -> auth/account
  - `fdesk.flwdesk.com` -> dashboard and servers
  - `status.flwdesk.com` -> status
  - `pay.flwdesk.com` -> payment
- Local host mapping is already supported through `*.localhost`.
- Canonical host and workspace rewriting is implemented in `lib/routing/subdomains.ts`.

### Current Folder Architecture

- `app/`
  - Public marketing pages
  - Auth/account pages
  - Dashboard/servers pages
  - Status pages
  - API routes under `app/api`
- `components/`
  - Workspace shells for account/dashboard/servers
  - Reusable landing visual system
  - Domain, payment, status, transcript, account, server modules
- `lib/`
  - Auth/session system
  - Security/FlowSecure
  - Payments
  - Plans/licensing
  - Teams
  - Status
  - Domains/OpenProvider
  - FlowAI
  - Supabase access wrappers
- `hooks/`
  - Small account status/data hooks

### Auth And Session Model

- This project does **not** use Supabase Auth as the user session authority.
- Authentication is custom and stored in project tables like:
  - `auth_users`
  - `auth_sessions`
  - `auth_user_credentials`
  - `auth_email_otp_challenges`
  - `auth_password_reset_tokens`
- Providers already implemented:
  - Discord
  - Google
  - Microsoft
  - Email/password + OTP
- Core session entrypoint:
  - `lib/auth/session.ts`
- The current session is read from custom cookies and verified against `auth_sessions`.
- OAuth tokens are encrypted at rest with FlowSecure before storage.

### Supabase Integration

- Browser client: `lib/supabaseBrowser.ts`
- Service-role/admin client: `lib/supabase/admin.ts` re-exported by `lib/supabaseAdmin.ts`
- The service-role client includes:
  - custom timeout handling
  - retries
  - circuit breaker
  - concurrency backpressure
  - short-lived read coalescing
- Most server mutations and sensitive reads already use the service-role client on the server.

### Security Layer

- `proxy.ts` is effectively a global request security gateway.
- Existing protections include:
  - canonical host enforcement
  - same-origin mutation validation
  - CSP generation
  - no-store headers for sensitive APIs
  - request ID propagation
  - FlowSecure rate limiting via `apply_flowsecure_rate_limit` RPC with local fallback
- Core security files:
  - `lib/security/http.ts`
  - `lib/security/rateLimit.ts`
  - `lib/security/requestSecurity.ts`
  - `lib/security/flowSecure.ts`
- Existing audit/security log table already used by the app:
  - `auth_security_events`

### Existing Product Domains In Code

- Billing/payments:
  - `lib/payments/*`
  - `app/api/payments/mercadopago/webhook/route.ts`
  - `app/api/internal/payments/reconcile/route.ts`
- Discord/server management:
  - `lib/servers/*`
  - `app/servers/*`
  - many `app/api/auth/me/guilds/*` routes
- Account and plans:
  - `lib/account/*`
  - `lib/plans/*`
- Teams:
  - `lib/teams/userTeams.ts`
  - `app/api/auth/me/teams/*`
- Status/incidents:
  - `lib/status/*`
  - `app/status/page.tsx`
  - `app/api/status/*`
- Domains:
  - `lib/openprovider/*`
  - `lib/domains/*`
  - `app/domains/*`
  - `app/api/domains/*`
- FlowAI:
  - `lib/flowai/*`
  - `app/api/v1/flowai/*`
  - `app/api/internal/flowai/*`
- Support/tickets:
  - `tickets`, `ticket_transcripts`
  - `lib/account/supportTickets.ts`
  - `app/api/auth/me/support-tickets/route.ts`

### Build, Lint, Tests

- Available scripts:
  - `npm run dev`
  - `npm run build`
  - `npm run start`
  - `npm run lint`
  - `npm run security:flowsecure`
  - `npm run security:secrets`
- Current repo has **no test script** and no established automated test directory.
- Current repo has **no shared migration folder/pipeline**.
- Current repo only includes one SQL file in-app: `lib/affiliates/schema.sql`.

## Existing Environment Variables

Existing env keys are centralized in `.env.exemple` and grouped by:

- URL/canonical host configuration
- Supabase
- auth/session/cookie security
- Discord/Google/Microsoft auth
- Discord bot/community IDs
- status webhooks and health
- FlowSecure
- FlowAI/OpenAI
- SMTP
- Mercado Pago
- OpenProvider
- ticket limits and transcript access

Important implementation note:

- There is already a clear env convention for first-party infrastructure and secrets.
- The bootstrap admin flow should follow the same pattern and introduce:
  - `FLOWDESK_BOOTSTRAP_ADMIN_EMAIL`
  - additional FLWIP/test-variable keys only when strictly required

## Real Design System Audit

### Visual Identity

The current workspace UI is not generic SaaS UI. It has a strong Flowdesk-specific shell:

- Backgrounds:
  - `#040404`, `#050505`, `#070707`, `#0A0A0A`
- Borders:
  - mostly `#0E0E0E`, `#111111`, `#141414`, `#151515`, `#171717`
- Primary accent:
  - blue `#0062FF`
- Neutral text:
  - bright: `#F0F0F0` to `#EEEEEE`
  - muted: `#7D7D7D`, `#6A6A6A`, `#555555`
- Status accents:
  - warning gold/yellow
  - danger red
  - success green

### Layout Patterns

- Very rounded shells:
  - `rounded-[20px]`
  - `rounded-[24px]`
  - `rounded-[28px]`
  - `rounded-[32px]`
- Cards use dark layered backgrounds, subtle borders, and large soft shadows.
- Pages rely on large headings with gray gradient text.
- Small eyebrow tags reuse `LandingGlowTag`.
- Motion uses `LandingReveal` and global `flowdesk-*` animation classes.

### Reusable Visual Primitives Already Present

- `components/landing/LandingGlowTag.tsx`
- `components/landing/LandingReveal.tsx`
- `components/account/DangerActionModal.tsx`
- `components/servers/PermissionDeniedState.tsx`
- `components/workspace/WorkspaceRouteLoading.tsx`
- `components/login/ButtonLoader.tsx`
- global helpers in `app/globals.css`

### Sidebar And Workspace Shell Patterns

Observed in:

- `components/dashboard/DashboardWorkspace.tsx`
- `components/account/AccountWorkspace.tsx`
- `components/servers/ServersWorkspace.tsx`

Shared shell conventions:

- left sidebar + large content stage
- black sidebar shell with `bg-[#050505]` and `border-[#0E0E0E]`
- content area with wide gutters and a max content width around `1220px`
- mobile fallback renders the same shell as a card above content

### Forms, Tables, Inputs, Buttons

The current project does not use a shared headless UI library. Patterns are handwritten but consistent:

- Inputs:
  - dark background
  - rounded `10-16px`
  - border `#151515` or `#1A1A1A`
  - focus border blue `rgba(0,98,255,0.3x)`
- Primary buttons:
  - bright light fill or blue-tinted state depending on module
  - slightly scaled hover states
- Secondary buttons:
  - dark fill `#0D0D0D` with border `#171717`
- Danger actions:
  - modal confirm buttons use red gradient
- Empty/restricted states:
  - centered, branded, tag + headline + muted copy

### Loading And Motion

Global classes already available and should be reused:

- `flowdesk-shimmer`
- `flowdesk-sheet-up`
- `flowdesk-stage-fade`
- `flowdesk-card-rise`
- `flowdesk-fade-up-soft`
- `flowdesk-slide-down`

### Design Decision For Admin

The admin panel must reuse the existing dark workspace language:

- same shell widths and sidebar geometry
- same `LandingGlowTag` eyebrow system
- same border colors and card corners
- same button/input density
- same motion classes

No separate design system should be invented for admin.

## Existing Routes And Route Placement

### Important Current Areas

- `/dashboard`
- `/servers`
- `/account`
- `/status`
- `/domains`
- `/payment`
- `/config`
- `/login`

### Current Admin Presence

- There is no real `/admin` page tree today.
- The only admin-like endpoint is:
  - `app/api/admin/backfill-incidents/route.ts`
- That endpoint is cron-token protected and is not a general staff/admin system.

### Recommended Admin Placement

Primary route:

- `/admin`

Target production behavior:

- Phase 1: `/admin` route tree on the current app
- Phase 2: optionally extend `lib/routing/subdomains.ts` and `proxy.ts` so `admin.flwdesk.com` rewrites to the `/admin` workspace without breaking existing `fdesk`, `account`, `status`, or `pay`

## Existing Database Surface Found In Code

Tables referenced by the current app include:

- `auth_users`
- `auth_sessions`
- `auth_security_events`
- `auth_user_api_keys`
- `auth_user_discord_links`
- `auth_user_payment_methods`
- `auth_user_hidden_payment_methods`
- `auth_user_plan_state`
- `auth_user_plan_guilds`
- `auth_user_plan_flow_points`
- `auth_user_plan_scheduled_changes`
- `auth_user_plan_downgrade_enforcements`
- `auth_user_teams`
- `auth_user_team_members`
- `auth_user_team_roles`
- `auth_user_team_servers`
- `payment_orders`
- `payment_order_events`
- `payment_methods`
- `payment_provider_event_inbox`
- `tickets`
- `system_components`
- `system_incidents`
- `system_incident_updates`
- `system_incident_components`
- `system_status_history`
- `system_status_monitor_snapshots`
- `system_status_subscriptions`
- `system_status_webhook_deliveries`
- `guild_*` settings tables for Discord server configuration

## Existing Systems Audit Per Planned Admin Module

### Module: Team / Roles / Permissions

- Systems existing found:
  - user/team/server operational RBAC
- Files existing related:
  - `lib/teams/userTeams.ts`
  - `components/account/tabs/TeamsTab.tsx`
  - `app/api/auth/me/teams/*`
- Tables existing related:
  - `auth_user_teams`
  - `auth_user_team_members`
  - `auth_user_team_roles`
  - `auth_user_team_servers`
- APIs existing related:
  - `/api/auth/me/teams`
  - `/api/auth/me/teams/[teamId]/members`
  - `/api/auth/me/teams/[teamId]/roles`
- Components existing related:
  - `TeamsTab`
- What will be reused:
  - style patterns
  - custom permission UI idioms
  - server-side permission-check architecture style
- What will be expanded:
  - none directly at data-model level for admin RBAC
- What will be created from scratch:
  - `admin_staff_profiles`
  - `admin_roles`
  - `admin_permissions`
  - `admin_role_permissions`
  - `admin_staff_role_assignments`
- Risk of duplication:
  - high if admin roles are merged with team/server roles
- Technical decision:
  - keep server/team RBAC untouched
  - add separate institutional RBAC for internal staff only

### Module: Users / Customers

- Systems existing found:
  - custom auth user accounts
  - sessions
  - plan/account summary
- Files existing related:
  - `lib/auth/session.ts`
  - `lib/account/summary.ts`
  - `app/api/auth/me/account/*`
- Tables existing related:
  - `auth_users`
  - `auth_sessions`
  - `auth_user_api_keys`
  - `account_violations`
- APIs existing related:
  - `/api/auth/me/account`
  - `/api/auth/me/account/summary`
- Components existing related:
  - account overview and tabs
- What will be reused:
  - `auth_users` as the identity source
- What will be expanded:
  - internal staff profiles linked to `auth_users`
- What will be created from scratch:
  - admin views, filters, safe staff lifecycle actions
- Risk of duplication:
  - medium
- Technical decision:
  - never create a second users table
  - admin identity must reference `auth_users.id`

### Module: Payments / Billing

- Systems existing found:
  - large Mercado Pago integration
  - reconciliation
  - plan delivery
  - payment history and methods
- Files existing related:
  - `lib/payments/*`
  - `lib/plans/*`
  - `app/api/payments/mercadopago/webhook/route.ts`
  - `app/api/internal/payments/reconcile/route.ts`
  - `app/api/auth/me/payments/*`
- Tables existing related:
  - `payment_orders`
  - `payment_order_events`
  - `payment_methods`
  - `payment_provider_event_inbox`
  - plan state tables
- APIs existing related:
  - `/api/auth/me/payments/*`
  - `/api/payments/mercadopago/webhook`
- Components existing related:
  - account billing tabs
  - checkout components
- What will be reused:
  - all payment/order tables and reconciliation services
- What will be expanded:
  - admin read/export/refund actions with audit
- What will be created from scratch:
  - admin surface only
- Risk of duplication:
  - very high if a second billing model is created
- Technical decision:
  - admin billing views will sit on top of existing payment tables/services only

### Module: Servers / Hosting / Domains

- Systems existing found:
  - Discord server licensing and settings
  - managed server catalog
  - OpenProvider domain integration
  - status monitor has SquareCloud hosting references
- Files existing related:
  - `lib/servers/*`
  - `lib/openprovider/*`
  - `lib/domains/*`
  - `app/servers/*`
  - `app/api/auth/me/guilds/*`
  - `app/api/domains/*`
- Tables existing related:
  - `auth_user_plan_guilds`
  - `guild_*` config tables
- APIs existing related:
  - managed servers APIs
  - guild settings APIs
  - domain search/AI/health/rates APIs
- Components existing related:
  - `ServersWorkspace`
  - server editor flows
  - domain pages
- What will be reused:
  - existing managed server and domain services
- What will be expanded:
  - admin read-only and safe-action surfaces
- What will be created from scratch:
  - admin aggregation pages only
- Risk of duplication:
  - high
- Technical decision:
  - admin uses current guild/domain models without replacing them

### Module: Support

- Systems existing found:
  - tickets and transcripts
- Files existing related:
  - `lib/account/supportTickets.ts`
  - `app/api/auth/me/support-tickets/route.ts`
  - transcript routes
- Tables existing related:
  - `tickets`
  - `ticket_transcripts`
- APIs existing related:
  - `/api/auth/me/support-tickets`
  - transcript routes
- Components existing related:
  - tickets account tab
- What will be reused:
  - existing ticket source tables
- What will be expanded:
  - admin filtering/assignment/closure only if current data model supports it safely
- What will be created from scratch:
  - admin support operations layer
- Risk of duplication:
  - high
- Technical decision:
  - no second support database model

### Module: Status

- Systems existing found:
  - mature public status service
  - incidents and updates
  - monitor snapshots
- Files existing related:
  - `lib/status/service.ts`
  - `lib/status/monitors.ts`
  - `app/api/status/*`
  - `app/api/admin/backfill-incidents/route.ts`
- Tables existing related:
  - `system_components`
  - `system_incidents`
  - `system_incident_updates`
  - `system_incident_components`
  - `system_status_history`
  - `system_status_monitor_snapshots`
- APIs existing related:
  - `/api/status/*`
  - `/api/admin/backfill-incidents`
- Components existing related:
  - `StatusPageClient`
- What will be reused:
  - full status domain model
- What will be expanded:
  - protected admin incident management surface
- What will be created from scratch:
  - admin CRUD wrappers and audit
- Risk of duplication:
  - low if the same tables are used
- Technical decision:
  - status admin should operate directly on the existing status tables

### Module: FlowAI

- Systems existing found:
  - internal/public FlowAI services and queues
- Files existing related:
  - `lib/flowai/*`
  - `app/api/v1/flowai/*`
  - `app/api/internal/flowai/*`
- Tables existing related:
  - `flowai_api_request_events`
  - `flowai_job_queue`
- APIs existing related:
  - FlowAI public and internal routes
- Components existing related:
  - status references only
- What will be reused:
  - existing metrics/log sources
- What will be expanded:
  - admin inspection controls
- What will be created from scratch:
  - admin FlowAI page
- Risk of duplication:
  - medium
- Technical decision:
  - do not build a second AI event pipeline

### Module: Security / Audit

- Systems existing found:
  - request-level security events
  - FlowSecure encryption, hashing, DTO validation
  - rate limiting
- Files existing related:
  - `lib/security/http.ts`
  - `lib/security/rateLimit.ts`
  - `lib/security/requestSecurity.ts`
  - `lib/security/flowSecure.ts`
- Tables existing related:
  - `auth_security_events`
- APIs existing related:
  - all sensitive auth/guild APIs already log or protect selectively
- Components existing related:
  - account status, restricted states
- What will be reused:
  - FlowSecure encryption and hashing primitives
  - request security context/audit style
- What will be expanded:
  - dedicated admin audit log model
  - admin session tracking
- What will be created from scratch:
  - `admin_audit_logs`
  - `admin_sessions`
  - `admin_action_approvals`
- Risk of duplication:
  - medium
- Technical decision:
  - keep `auth_security_events` for security telemetry
  - add a dedicated `admin_audit_logs` stream for institutional operations

### Module: Test Variables / FLWIP / Developer CLI

- Systems existing found:
  - partial encrypted test-variable service foundation discovered during implementation
- Files existing related:
  - `lib/test-variables/service.ts`
- Tables existing related:
  - admin/FLWIP tables are introduced by the new SQL migration set
- APIs existing related:
  - none before the new admin/dev-auth/dev API layer
- Components existing related:
  - account workspace is the best visual host for a developer portal tab
- What will be reused:
  - auth session model
  - FlowSecure encryption/hashing
  - account workspace UX
- What will be expanded:
  - `lib/test-variables/service.ts`
  - account navigation with a developer environment entry
- What will be created from scratch:
  - FLWIP login-token delivery
  - dev auth routes
  - CLI package and browser login bridge
- Risk of duplication:
  - low
- Technical decision:
  - keep the existing encrypted service as the core backend
  - add the missing API/UI/CLI/auth delivery layers around it

## Current Security Findings

### Positive Findings

- Sensitive APIs already receive no-store headers.
- Mutating auth/transcript APIs are same-origin protected.
- Request IDs are propagated.
- FlowSecure provides real encryption and HMAC helpers.
- Service-role access is kept server-side in current code.
- Rate limiting is already strong and central.

### Gaps Relative To The Admin Requirement

- No dedicated admin route protection exists yet.
- No institutional staff profile model exists.
- No backend admin permission matrix exists.
- No admin audit log model exists.
- No dedicated admin approval workflow exists.
- No dev IP allowlist/certificate/test-variable system exists.

## Implementation Architecture Decision

### Admin Route Shape

Primary route tree to implement:

- `/admin`
- `/admin/team`
- `/admin/roles`
- `/admin/permissions`
- `/admin/users`
- `/admin/customers`
- `/admin/servers`
- `/admin/domains`
- `/admin/hosting`
- `/admin/payments`
- `/admin/billing`
- `/admin/support`
- `/admin/status`
- `/admin/flowai`
- `/admin/security`
- `/admin/test-variables`
- `/admin/test-variables/approvals`
- `/admin/test-variables/certificates`
- `/admin/test-variables/logs`
- `/admin/audit`
- `/admin/settings`

Implementation note:

- The route tree can be implemented with dedicated files or a catch-all admin router if that keeps consistency and avoids duplication.

### Admin Data Model

New tables required:

- `admin_staff_profiles`
- `admin_roles`
- `admin_permissions`
- `admin_role_permissions`
- `admin_staff_role_assignments`
- `admin_audit_logs`
- `admin_sessions`
- `admin_action_approvals`
- `dev_ip_requests`
- `dev_ip_allowlist`
- `dev_certificates`
- `test_variable_projects`
- `test_variable_groups`
- `test_variables`
- `test_variable_access_grants`
- `test_variable_read_logs`

Additional helper tables likely required for clean CLI auth:

- `dev_login_attempts`
- `dev_auth_tokens` or equivalent hashed session table

### RBAC Model

Correct model to implement:

- `auth_users` -> `admin_staff_profiles`
- `admin_staff_profiles` -> active role assignments
- role assignments -> `admin_roles`
- role permissions -> `admin_role_permissions`
- effective permissions -> `admin_permissions`

Important separation:

- existing `auth_user_team_roles` are for customer/team server access
- new `admin_roles` are for internal organizational staff access

### Singleton Roles

The following roles must be singleton-enforced:

- CEO
- COO
- CTO
- CFO

Implementation decision:

- enforce in application service layer
- add SQL trigger/guard so duplicate active singleton assignments are rejected even if a direct insert is attempted

### Audit Model

Every sensitive admin action should write `admin_audit_logs` with:

- actor user ID
- action code
- target type
- target ID
- redacted metadata
- IP hash
- user-agent hash
- risk level

Existing `auth_security_events` remains separate and is not a substitute.

### Test Variable Security Model

- secrets encrypted at rest with FlowSecure
- decryption only on server
- all reads logged
- `public`, `internal`, `sensitive`, `critical` levels supported
- production blocked by policy in the first implementation
- environments initially allowed:
  - `test`
  - `staging`
  - `sandbox`

### Developer Portal Placement

Preferred placement:

- extend existing account workspace with `account/dev-environment`

Reason:

- authenticated staff already use the account shell
- visually consistent
- no new public UX system needed

## Files Expected To Be Created

Planned new areas:

- `docs/admin/*`
- `components/admin/*`
- `lib/admin/*`
- `packages/test-variables/*`
- `app/admin/*`
- `app/api/admin/*`
- `app/api/dev-auth/*`
- `app/api/dev/*`
- SQL migration/seed folder for admin and FLWIP tables

## Implementation Delta

### Core Admin Foundation

- `app/admin/*` now includes:
  - `/admin`
  - `/admin/team`
  - `/admin/roles`
  - `/admin/permissions`
  - `/admin/users`
  - `/admin/customers`
  - `/admin/servers`
  - `/admin/domains`
  - `/admin/hosting`
  - `/admin/payments`
  - `/admin/billing`
  - `/admin/support`
  - `/admin/status`
  - `/admin/security`
  - `/admin/flowai`
  - `/admin/test-variables`
  - `/admin/test-variables/approvals`
  - `/admin/test-variables/certificates`
  - `/admin/test-variables/logs`
  - `/admin/audit`
  - `/admin/settings`
- Admin shell components were added under `components/admin/*`.
- Server-side RBAC, audit, catalog and operational readers live under `lib/admin/*`.

### FLWIP / Test Variables

- Real backend routes now exist under:
  - `app/api/admin/test-variables/*`
  - `app/api/dev/*`
  - `app/api/dev-auth/*`
- Developer portal is live in:
  - `/account/dev-environment`
- CLI package now exists in:
  - `packages/test-variables`

### SQL / Seeds

- SQL files added:
  - `sql/admin/001_admin_panel.sql`
  - `sql/admin/002_admin_seed.sql`
  - `sql/admin/003_dev_auth_login_tokens.sql`

## Files Expected To Be Modified

High-probability touch points:

- `app/globals.css`
- `app/account/[tab]/page.tsx`
- `app/account/layout.tsx`
- `components/account/AccountWorkspace.tsx`
- `components/account/TabRegistry.tsx`
- `lib/account/tabs.ts`
- `lib/routing/subdomains.ts`
- `proxy.ts`
- `lib/security/flowSecure.ts`
- `package.json` if tests/package scripts need to be added

## Risks

- No existing migration framework in this repo means SQL files must establish a new convention.
- The admin route can conflict with canonical host routing if subdomain support is added carelessly.
- Existing server/team RBAC names are similar to the new admin RBAC scope and must stay isolated.
- The codebase uses service-role access heavily; admin helpers must ensure sensitive checks are always done before DB writes.
- The developer CLI flow requires extra ephemeral auth tables/routes not present today.

## Phase Checklist

### Phase 1 — Audit

- [x] Map stack
- [x] Map routing
- [x] Map auth/session
- [x] Map Supabase usage
- [x] Map security layer
- [x] Map real design system
- [x] Identify existing systems per module
- [x] Write this analysis file

### Phase 2 — Base Admin

- [x] Create route tree and admin shell
- [x] Reuse Flowdesk design primitives
- [x] Protect `/admin`

### Phase 3 — RBAC

- [x] Add admin staff/role/permission tables
- [x] Sync role and permission seed
- [x] Add singleton enforcement
- [x] Add server-side admin auth helpers

### Phase 4 — Operational Modules

- [x] Team
- [x] Roles
- [x] Permissions
- [x] Users
- [x] Customers
- [x] Payments/Billing
- [x] Servers/Domains/Hosting
- [x] Support
- [x] Status
- [x] Security
- [x] Audit

### Phase 5 — Test Variables

- [x] Project/group/variable tables
- [x] Encrypted value storage
- [x] Admin CRUD and logs
- [x] Pull API for authorized developers

### Phase 6 — FLWIP

- [x] IP requests
- [x] Approvals
- [x] Certificates
- [x] Runtime validation
- [x] Revocation and expiry

### Phase 7 — CLI

- [x] Package scaffolding
- [x] Login flow
- [x] IP request flow
- [x] Env pull
- [x] Process injection via `flw dev --`

### Phase 8 — Final Validation

- [x] Documentation set
- [x] Tests
- [x] Lint
- [x] Build

## Immediate Next Step After Audit

Implement the admin foundation in this order:

1. Create admin data definitions and server-side RBAC helpers.
2. Add SQL schema/seed files for the new admin and FLWIP tables.
3. Build the `/admin` shell using the existing Flowdesk visual language.
4. Wire overview/team/roles/permissions first because all later modules depend on them.
