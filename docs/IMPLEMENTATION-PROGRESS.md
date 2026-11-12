# Implementation Progress

Last updated: 2026-11-02

## Starting point (audit)

- **Backend**: largely complete — auth/RBAC, item CRUD + Excel import, full location hierarchy, transactional stock movements with idempotency, bin suggestion, alerts, reservations, Excel reports, activity log. Gaps: CORS open to all origins, no body size limit, no login rate limit, read routes (items, locations) unauthenticated, no `/auth/me`, password change, or user edit, no item image upload, no dashboard aggregate, master-data changes not audited, locations with stock could be deactivated, unused `next` dependency, no tests, docs described NestJS.
- **Frontend**: a single placeholder `page.tsx` — JWT kept in `sessionStorage`, a hard-coded demo login, menu modules that were placeholders, no routing, no Tailwind component set, no TanStack Table/Recharts.

## Phases

| Phase | Status | Notes |
| --- | --- | --- |
| 1 Audit + foundation (API proxy, layout, auth) | Done | Cookie session via `/api/session`, proxy `/api/backend/*`, `src/proxy.ts`, AppLayout with collapsible/mobile sidebar, breadcrumbs, alert bell |
| 2 Dashboard | Done | `GET /api/dashboard`; cards, 14-day chart, alerts, recent transactions, bin usage per warehouse |
| 3 Item Master | Done | Search, filters, server sorting/pagination, create/edit/view, activate/deactivate, images, Excel import/export |
| 4 Warehouse hierarchy | Done | Five-column browser with add/edit/activate/deactivate, bin capacity bars, bin search, bin contents, bin suggestion |
| 5 Inventory | Done | Item / warehouse / bin filtering, status badges, reservations, export |
| 6 Stock transactions | Done | All five types, source/destination pickers, suggestions, client + server validation, review step, idempotent posting, history with filters + export |
| 7 Alerts + reports | Done | Alert tabs with counts, suggested order qty; 13 reports with preview, Excel, print |
| 8 Users + settings | Done | User list/search/filter, create, edit (name, role, password reset), activate/deactivate, per-user activity; profile, password change, backend status |
| 9 Integration + quality | Done | See tests below |
| 10 Documentation | Done | README, ARCHITECTURE, this file, `.env.example` files |

## Tests performed (2026-11-02, in a Linux workspace with Node 22 and MongoDB 8.3 single-node replica set)

| Check | Result |
| --- | --- |
| `frontend: npm run lint` | Pass, 0 problems |
| `frontend: npm run build` | Pass (15 routes). Note: the workspace could not reach Google Fonts, so the build was run with `next/font/google` stubbed out temporarily; `layout.tsx` is unchanged |
| `backend: npm test` | 27/27 pass (auth required on every protected route, forged/expired tokens, JSON errors, body limit, CORS, Helmet, roles, rate limiter) |
| `backend: npm run test:integration` | 4/4 pass against a `_test` database (login, user rules, hierarchy, duplicate/threshold validation, receipt/issue/transfer, idempotent replay, capacity and over-issue rejection, Viewer 403s, inventory/capacity balances, stock-holding warehouse deactivation blocked, dashboard, alerts, movement warehouse filter, Excel report, audit log) |
| Browser (Playwright, production build) | All pages load for admin with no console errors; Viewer on 390 px mobile sees role-filtered menu, no write buttons, Access denied on Stock Movements, no horizontal page scroll; logout and expired-cookie redirect work |
| Browser workflows | Item create with validation, duplicate code rejected, search/sort, image upload (fake image rejected), Excel import (1 created / 1 updated / 1 skipped), Excel export, deactivate/activate, bin create with capacity validation, receipt via automatic suggestion, over-issue blocked, inventory quantity and reservation, alerts tabs, receipt and activity reports, warehouse stock export, user creation, password change and re-login — all pass |
| Session security (curl) | Cookie `HttpOnly; SameSite=Strict; Secure` (production); POST without `x-wms-request` or with a foreign Origin → 403; path traversal → 400 |
| `npm audit` | Backend: 0. Frontend: 16 moderate, all `minimatch` inside ESLint dev tooling (same as before this work; not shipped to the browser). Not force-fixed because it needs a major ESLint plugin change |

Not run on your machine: nothing here touched your real MongoDB; all data tests used throwaway databases.

## Stage: Material Request workflow (2026-11-02)

Created: `backend/models/MaterialRequest.js`, `MaterialRequestIssue.js`, `MaterialRequestAudit.js`, `backend/controllers/materialRequestController.js`, `backend/routes/materialRequestRoutes.js`, `backend/tests/integration/materialRequest.test.js`, `frontend/src/app/(app)/material-requests/` (list, `new/`, `view/` with `IssuePanel`, status badge).

Modified: `backend/index.js` (route), `backend/models/User.js` (roles Technician, Engineering Executive, Engineering Manager added — existing users unchanged), `backend/controllers/stockMovementController.js` (stock helpers exported for reuse, logic unchanged), `backend/tests/unit/security.test.js`, `frontend/src/lib/roles.ts`, `frontend/src/lib/types.ts`, `frontend/src/components/layout/navigation.ts` (menu item), `frontend/src/components/layout/AppLayout.tsx` (white print background), `frontend/src/app/(app)/users/UsersView.tsx` (role descriptions), docs.

| Check | Result |
| --- | --- |
| `backend: npm test` | 30/30 pass |
| `backend: npm run test:integration` | 13/13 pass (4 existing + 9 MR groups covering all 15 brief scenarios, incl. concurrent approvals, concurrent issues on the same bin and on the same request, parallel duplicate idempotency keys) |
| `frontend: npm run lint` / build | Pass (build with the Google Fonts stub, as before) |
| Browser (production build) | Technician create+submit → Executive approve → Manager sees no approve button → Storekeeper partial issue (short stock), hold with reason, resume, receive stock, issue rest → Technician confirms receipt with a shortage; audit shows all 8 steps; print layout; 390 px mobile list without sideways scroll; no console errors |

MR limitations (updated in the next stage):
- A rejected request cannot be resubmitted (create a new one).
- Admin "MR settings" (e.g. configurable approver rules, departments list) are not built; department is free text.
- Reservations are not made at approval time, so stock can be used by other issues before the store issues the MR.

## Stage: availability, receipts, New Item Requests, documents (2026-11-02)

Created: `backend/models/NewItemRequest.js`, `backend/controllers/newItemRequestController.js`, `backend/routes/newItemRequestRoutes.js`, `backend/tests/integration/newItemRequest.test.js`, `frontend/src/app/(app)/material-requests/availability/`, `frontend/src/app/(app)/new-item-requests/` (list, `edit/`, `view/`), `frontend/src/app/documents/` (material-request, new-item-request), `frontend/src/components/document/DocumentShell.tsx`, `frontend/src/components/ItemThumb.tsx`.

Modified: `backend/controllers/itemController.js` + `routes/itemRoutes.js` (availability endpoints), `materialRequestController.js` + routes (item images on lines, delete draft, queue `ISSUED`/date filters, repeatable partial receipts, shared number generator), `models/MaterialRequest.js` (`receipts` history replaces the single `receipt`; `receivedQuantity` starts at 0), `controllers/itemImageController.js` (image check exported), `index.js`, tests, MR screens (availability on the form, prefill, delete draft, hold reasons, receipt dialog, thumbnails, approver column, date filters, document link), navigation, roles, types, `.env.example`, docs.

| Brief test cases | How verified | Result |
| --- | --- | --- |
| 1–6 Availability | integration "availability" test + browser | Pass (search, available qty, OUT_OF_STOCK / LOW_STOCK, missing item = no rows, image loaded, technician 403 on reserve/issue/item edit) |
| 7–14 MR + approval | integration tests 1–7 + browser | Pass |
| 15–24 Store Keeper | integration tests 8–13 + "multiple partial issues" + browser | Pass (full, partial, three partial issues, hold with reason, resume, over-issue 409, no negative stock, duplicate key once, concurrent issues, audit) |
| 25–27 Receiving | integration test 14 + browser | Pass (partial receipts, excess blocked, RECEIVED only when fully issued and fully confirmed) |
| 28–33 New Item Request | `newItemRequest.test.js` + browser | Pass (draft, image, edit, submit, Executive queue, tracking, read-only, Manager/Store 403, no item/inventory/movement changes, no procurement) |
| 34–42 Documents | browser + Chromium PDF | Pass: form layout, item image, missing image placeholder, A4 PDF, 28-line draft paginates to 4 A4 pages with repeated header and DRAFT watermark, approval box only shows recorded data, viewing leaves `updatedAt` unchanged, other users get "not found" |

Commands: `backend npm test` 33/33, `npm run test:integration` 16/16, frontend lint clean, build passes (Google Fonts stubbed in the workspace as before).

Limitations:
- A recorded shortage (technician received less than issued) keeps the request open; there is no "close with discrepancy" action yet.
- New Item Request reference images are readable by any signed-in user who knows the random file name (same as item images).
- The printed company mark is text until `frontend/public/company-logo.png` is added.
- Print timestamp appears when printing from the browser (Print button or Ctrl+P); it is not part of the on-screen preview.

## Behaviour changes to be aware of

- `GET` on items, warehouses, zones, racks, levels, and bins now require a signed-in user (they were public).
- `PUT /items/:id` no longer accepts `images` (use the image endpoints); `image` must be one of the item's uploaded images.
- Deactivating a warehouse, zone, rack, or level that still holds stock now returns 409.
- Login rate limit: 10 failed attempts per account and 100 per client address in 15 minutes (successful sign-ins are not counted).
- CORS only allows `CLIENT_ORIGIN`.

## Known issues / limitations

- Changing a password or deactivating a user does not revoke tokens already issued; they expire within 8 hours (the backend does check `isActive` on every request, so deactivated users are blocked immediately).
- Rate-limit counters are in memory (reset on restart; one backend process).
- Behind the Next.js proxy, the backend sees the Next.js server's address, so audit-log IP addresses show `127.0.0.1` unless a reverse proxy in front of Next.js sets `X-Forwarded-For`.
- `GET /alerts` and the dashboard compute status for all active items in memory; fine for tens of thousands of items, revisit for much larger catalogs.
- Dashboard movement chart groups by UTC day.
- The stock summary report (per item per warehouse) is Excel-only; no on-screen preview.
- Viewers can export the movements report to Excel (existing backend rule) but cannot view movement history on screen.
- Item Excel export uses the search filter only (status/group/type filters are not applied by the backend export).

## Next steps

1. Enable the MongoDB replica set (README §1) and run `npm run test:integration` with `MONGODB_TEST_URI` on your machine.
2. Run `npm install` in both folders (frontend gained `recharts` and `@tanstack/react-table`; backend dropped `next`).
3. Optional: token revocation on password change, persistent rate limiting, item export filters, an on-screen stock summary.
