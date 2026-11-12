# Remaining implementation: API contract and operations

Updated: 2026-11-02. These changes extend the existing Express/Mongoose and Next.js applications. No hosted resources were changed.

## Authorization contract

- All business routes require a valid Bearer JWT and an active MongoDB user. Login, initial bootstrap, health and the root greeting are the intentional public exceptions. `/auth/me` remains available to authenticated users so revoked permissions can be reflected in active browser sessions.
- MongoDB `RolePermission.permissions` is authoritative. Missing records/keys deny access; permission-store failures return 503. Strings such as `"true"` never grant permission. Startup inserts missing role records once, using the documented initial role policy; it never restores a revoked permission or fills missing action grants on existing records.
- Module reads require the corresponding module permission. Actions require both their module permission and their action key. Password changes require `settings`. Downloads require `reports`; dashboard summaries require `dashboard`, with movement details additionally requiring `movements`.
- Action keys: `items.write`, `warehouses.write`, `inventory.reserve`, `movements.write`, `movements.adjust`, `materialRequests.create`, `materialRequests.review`, `materialRequests.approve`, `materialRequests.issue`, `materialRequests.receive`, `newItemRequests.create`, `newItemRequests.review`, `users.write`. Separate `activities` and `emailDeliveries` permissions control audit and delivery views.
- Request ownership, draft immutability, self-approval prevention and stock invariants remain enforced in controllers. Material Request read access outside ownership requires review, approval or issue permission. Default approval remains with Engineering Executive/Manager, while Super Admin can explicitly change action grants.
- Only the authenticated **Super Admin identity** may use `GET/PUT /permissions/roles[/:role]` and `GET /permissions/audit`. A configurable permission cannot confer permission-administration authority. PUT accepts a `permissions` object of known boolean keys; omitted keys become false. Concurrent changes return 409 and require reload. Changes carry actor, timestamp and before/after history within the same permission record, plus Activity history. Super Admin recovery keys `users`, `users.write`, `settings` cannot be revoked through the editor.
- Only Super Admin may assign/manage administrator or privileged roles (user administration, master-data writes, stock adjustment, approvals, executive review or email administration). Other account managers can delegate only roles whose entire permission set is within their own effective grants. `GET /auth/assignable-roles` supplies the allowed choices. Account edits/deactivation serialize within MongoDB transactions, preventing concurrent removal of the last active Super Admin.
- Browser sessions refresh permissions every 15 seconds and on focus. Direct API revocations apply on the next request. Navigation, page rendering, mutation controls and export controls consume effective session permissions. The server remains authoritative while the browser refresh is pending.

## Rack grid contract

- `GET /racks/:id/grid`: requires `warehouses`; returns `{rack, levels, bins}`, with populated per-item inventory on each bin, including quantities, units and reservations.
- `PUT /racks/:id/grid`: requires `warehouses` and `warehouses.write`; accepts `{rows: 1..20, columns: 1..20}` as integers. It adopts existing levels/bins, creates missing cells, and atomically archives empty bins outside the resized grid. Duplicate legacy level numbers must be corrected before adoption. Occupied/reserved cells cause 409 and roll back the entire resize.
- Existing `/bins` creation and rename/update endpoints remain available. The designer supports renaming bin names; the hierarchy editor also edits codes and other bin properties. Disabling uses `/bins/:id/deactivate`; re-enabling uses `/reactivate`.
- `DELETE /bins/:id` archives an empty bin. It never physically deletes it. Archived bins release their grid position, remain inspectable and cannot be reactivated. Save the grid to create replacement empty cells. Occupied bins cannot be archived or disabled. Concurrent stock edits are detected through bin revisions or transaction conflicts.
- Existing Bin IDs and StockMovement/Inventory references survive renames, adoption and archival. Mobile uses a single-column bin list; wider grids scroll within the designer.

## Notification contract

- `POST /notifications/socket-ticket`: authenticated and `notifications` permission required; returns a 60-second, audience-restricted Socket.IO handshake ticket. Browser JavaScript never reads the HTTP-only login token. Tickets expire at handshake; connected sockets also disconnect when the underlying login session expires.
- The browser connects to `NEXT_PUBLIC_SOCKET_URL`; backend CORS uses `CLIENT_ORIGIN`. Each socket joins only its own server-selected user room. Clients cannot choose recipient rooms.
- `notification:new` contains the persisted notification. Recipients must be active and currently authorized for notifications and the source module. Delivery rechecks current user permissions. History/count/read APIs filter by recipient and current source-module grants.
- MongoDB history is authoritative. Every connection/reconnection reloads history and unread count, covering offline events without locally incrementing duplicate counters. The bell also reconciles every 30 seconds; marking notifications read refreshes it across the current browser page.
- The supported deployment is one long-running Socket.IO backend process. Multiple backend replicas need a shared Socket.IO adapter and appropriate load-balancer configuration before claiming cross-process instant delivery.

## Email contract and local setup

- Workflow notifications persist `emailRequested` intent independently of SMTP availability. `EmailDelivery` tracks queued/sending/retrying/sent/skipped/failed, attempts, next attempt, sent timestamp and a sanitized failure category. A unique `(notificationId,userId)` index and notification event dedupe prevent concurrent duplicate queue entries.
- The backend starts a worker that reconciles persisted intents, atomically claims jobs and sends outside warehouse transactions. SMTP failure cannot roll back or wait on warehouse transactions. Five attempts maximum, with exponential delay starting at 30 seconds and capped at one hour. Concurrent workers cannot claim the same job.
- Recipients are reauthorized before sending. Lost worker leases and ambiguous SMTP outcomes are quarantined as failed instead of automatically risking duplicate mail. A stable Message-ID helps trace deliveries; SMTP cannot provide a universal exactly-once guarantee after an uncertain network acknowledgment. Check the receiving server before manually retrying an ambiguous delivery.
- `GET /notifications/email-deliveries?page=1` requires notifications + emailDeliveries. It returns 50 delivery summaries per page, without email bodies or recipient addresses. The Notifications page exposes status, attempts and failure visibility.
- Set backend `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`true` for implicit TLS), `SMTP_FROM`, and optional `SMTP_USER`/`SMTP_PASS`. Local SMTP may omit credentials; public SMTP should use its provider's required authentication/TLS settings. Never put SMTP credentials in frontend variables.
- The integration test starts a real SMTP server bound to `127.0.0.1` on an ephemeral port. It tests a temporary 451 rejection, successful retry, concurrent claiming, dedupe, exhausted retries, reconciliation and warehouse operation survival. It sends no external mail and needs no SMTP credentials.

## Running verification

Install dependencies separately in backend and frontend (`npm ci` in each). Node 24 and a transaction-capable MongoDB replica set were used for these checks.

1. Start an isolated local MongoDB replica set on port **27028**, with replica-set name **wmsqa** and a dedicated test data directory. Initialize its single member as `127.0.0.1:27028`. Do not reuse an operational database or delete its data.
2. In PowerShell, set `$env:MONGODB_TEST_URI='mongodb://127.0.0.1:27028/wms_test?replicaSet=wmsqa'`, then run `npm test` and `npm run test:integration` from backend. Integration tests deliberately reset only the selected `_test` database.
3. From frontend run `npx playwright install chromium`, then `npm run test:e2e`. Browser QA uses only `wms_ui_test` on the isolated port, and temporary backend/frontend servers on **4008/3008**. Its fixture server refuses any other MongoDB destination. It does not use production accounts or SMTP settings.
4. Run frontend `npm run lint` and `npx tsc --noEmit`. For an isolated production build alongside an existing dev server, set `$env:WMS_QA='1'` and run `npm run build`; the output is `.next-qa`. Unset WMS_QA afterward for ordinary development. The normal dev server is left running.
5. Screenshots and A4 portrait/landscape PDF exports are retained in `frontend/output/qa/` (Git-ignored). E2E failure traces are in `frontend/test-results/`.

## First use on existing data

- Start the backend with its existing `MONGODB_URI`, `JWT_SECRET`, and correct `CLIENT_ORIGIN`. Stock operations, grid resizing/archival and protected account changes require a replica set (Atlas also supports transactions).
- Sign in as Super Admin and review the permission editor. Existing permission rows deliberately do not gain new write/action privileges automatically. Enable the required action keys explicitly and save each role; restore any missing Super Admin recovery keys before saving that role. New installations receive the initial policy only when each role record is first created.
- In Warehouse Management select a rack, choose rows/columns and Save grid. This adopts existing bins rather than replacing them. Resolve duplicate level numbers first, and move stock before shrinking occupied areas. Disabled cells stay disabled until explicitly enabled.
- Configure the public Socket.IO URL and allowed frontend origin. A reverse proxy must forward WebSocket upgrades (and polling if used). HTTPS frontends require a reachable HTTPS/WSS backend endpoint.
- Configure SMTP, restart the backend, and inspect delivery status under Notifications. Existing terminal failures are intentionally not resent automatically. Resolve and verify failures before any manual requeue.

## Verification limits

Automated browser checks use Chromium viewport emulation, not physical tablets/phones or a physical printer. Print exports exercise the real Chromium A4 renderer and authenticated item images. Production SMTP acceptance and infrastructure-specific HTTPS/reverse-proxy behavior require environment configuration and were not tested against external services. These are operational signoff items, not missing implementation modules.
