# Engineering Warehouse WMS — Architecture

Standalone WMS. Backend: Express 5 + Mongoose (ES modules). Frontend: Next.js 16 App Router + Tailwind CSS v4 with small custom components (no UI framework). SAP integration is optional in a later phase.

## Request flow

```text
Browser ──(HTTP-only cookie "wms_session")──> Next.js :3000
   │  /login, /items, ...        pages (client components)
   │  /api/session               sign in / sign out / current user
   │  /api/backend/<path>        proxy: cookie → "Authorization: Bearer <JWT>"
   ▼
Express API :4000/api ──> MongoDB (replica set)
```

- The JWT issued by `POST /api/auth/login` is stored only in an HTTP-only, `SameSite=Strict` cookie (`Secure` in production). Browser JavaScript never sees it.
- State-changing proxy calls must come from the app's own `Origin` and carry the `x-wms-request: 1` header (CSRF protection on top of SameSite).
- `src/proxy.ts` redirects visitors without a session cookie to `/login`. This is a convenience only; the backend checks the token and role on every API call.
- When the backend answers 401 (expired/invalid token) the proxy clears the cookie and the UI returns to `/login?expired=1`.

## Folder layout

```text
backend/
  index.js                 app setup: CORS (CLIENT_ORIGIN), Helmet, 1 MB JSON limit, routes, JSON errors
  middleware/              authMiddleware (JWT + roles), rateLimit (failed sign-ins)
  models/                  Item, Warehouse, Zone, Rack, Level, Bin, Inventory, StockMovement, User, Activity
  controllers/             one per resource; locationHelpers, itemImageController, dashboardController
  routes/                  one per resource
  tests/unit, tests/integration   node:test suites
  uploads/items/           item images (git-ignored, back up with the database)
frontend/src/
  proxy.ts                 optimistic login redirect
  app/login, app/forbidden public pages
  app/(app)/               protected pages: dashboard, items, warehouses, inventory, movements, alerts, reports, users, settings
  app/api/session, app/api/backend/[...path]   route handlers (session + API proxy)
  components/layout        AppLayout (sidebar, header, breadcrumbs), SessionProvider, navigation
  components/ui            Button, Field, Modal (native <dialog>), DataTable (TanStack Table), Feedback (cards, badges, notices)
  components/Pickers.tsx   item / warehouse / bin selectors backed by paginated APIs
  lib/                     api helper, useApi hook, roles, formatting, shared types
```

## Roles

| Capability | Super Admin | Warehouse Admin | Supervisor | Storekeeper | Viewer |
| --- | :-: | :-: | :-: | :-: | :-: |
| View items, locations, inventory, alerts, reports, dashboard | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit/deactivate items and locations, images, Excel import | ✓ | ✓ | | | |
| Receipts, issues, transfers, returns, reservations, bin suggestions, movement history | ✓ | ✓ | ✓ | ✓ | |
| Stock adjustments | ✓ | ✓ | ✓ | | |
| Activity history | ✓ | ✓ | ✓ | | |
| Manage users (non-admin roles) | ✓ | ✓ | | | |
| Manage administrators / grant admin roles | ✓ | | | | |

Guards: users cannot change their own role or deactivate themselves; the last active Super Admin cannot be deactivated or demoted.

## API (all under `/api`; all routes except `health`, `auth/login`, `auth/bootstrap` require a bearer token)

| Area | Endpoints |
| --- | --- |
| Health | `GET /health` |
| Auth | `POST /auth/bootstrap`, `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`, `GET/POST /auth/users`, `PATCH /auth/users/:id`, `PATCH /auth/users/:id/active` |
| Dashboard | `GET /dashboard` (counts, stock totals, alerts, bin usage per warehouse, 14-day movement series, recent movements) |
| Items | `GET /items` (search, isActive, itemGroup, itemType, uom, sort, order, page, limit), `GET /items/filters`, `GET/PUT/DELETE /items/:id` (DELETE = deactivate), `POST /items`, `POST /items/import` (.xlsx), `POST/DELETE /items/:id/images` |
| Locations | `/warehouses`, `/zones?warehouse=`, `/racks?zone=`, `/levels?rack=`, `/bins?level=|rack=|zone=|warehouse=&search=` — GET list/one, POST, PUT; deactivate via `DELETE` (warehouse, zone) or `PATCH /:id/deactivate|reactivate` (rack, level, bin) |
| Bin suggestion | `GET /bins/suggest?item=&warehouse=&quantity=` |
| Inventory | `GET /inventory` (item, bin, level, rack, zone, warehouse, search, page), `GET /inventory/summary`, `GET /inventory/summary/by-location`, `GET /inventory/warehouse/:id`, `GET /inventory/item/:id`, `GET /inventory/:id`, `POST /inventory/:id/reserve|release` |
| Movements | `GET /stock-movements` (item, warehouse, movementType, search, startDate, endDate, page), `POST /stock-movements/receipts|issues|transfers|adjustments|returns` |
| Alerts | `GET /alerts?type=out-of-stock|low-stock|reorder|minimum|maximum&warehouse=&search=&page=&limit=` |
| Activity | `GET /activities` (user, entityType, entityId, action, startDate, endDate, page) |
| Reports (.xlsx) | `GET /reports/items.xlsx`, `warehouse-stock.xlsx`, `bin-stock.xlsx`, `movements.xlsx`, `low-stock.xlsx`, `reorder.xlsx`, `summary.xlsx` |
| Images | `GET /uploads/items/<file>` (authenticated) |

List endpoints return `{ <records>, total, page, totalPages }`; `GET /warehouses` and `GET /zones` return plain arrays.

## Stock integrity

- Inventory changes only through `POST /stock-movements/*`. Each posting runs in one MongoDB transaction: validates the active Warehouse→Bin chain, item group restrictions, capacity unit = item UoM, free capacity, dedicated-bin rule, available (unreserved) stock; then updates `Inventory`, `Bin.usedCapacity`, writes `StockMovement` and `Activity`.
- `transactionReference` makes postings idempotent: resubmitting the same reference returns the original movement instead of posting twice. The UI generates one per form and keeps it on retry.
- Negative stock is impossible (`quantity >= amount` filter + schema `min: 0`).
- Warehouses, zones, racks, levels, and bins that still hold stock cannot be deactivated.

## Workflows

- **Items**: create → set min / reorder / max → upload images → (optional) bulk import from Excel (`Item No.`, `Item Description`, `UoM Group`, `Item Type`, `Item Group`, `BOM Type`, `Active`; existing codes are updated).
- **Locations**: Warehouse → Zone → Rack → Level → Bin. Bins may track capacity in a unit that must match the item UoM, restrict item groups, and be Mixed or Dedicated.
- **Receiving**: Stock Movements → Receipt → item, quantity → choose a bin manually or *Suggest bins* (bins already holding the item first, then the tightest fit) → review → post.
- **Issue / transfer / adjustment / return**: the source bin list shows only bins that hold the item and their available quantity.
- **Alerts**: out of stock (0 on hand), low stock (≤ max(minimum, reorder)), reorder, below minimum, above maximum. Suggested order = maximum − on hand when a maximum is set.
- **Reports**: on-screen preview with filters, Excel export, print.

## Material Requests (MR)

Digital version of the paper Material Request Form.

```text
DRAFT ─submit─> PENDING_APPROVAL ─approve (Executive OR Manager)─> PENDING_ISSUE ─issue─> PARTIALLY_ISSUED ─issue rest─> ISSUED ─receive─> RECEIVED
                        └─reject─> REJECTED            PENDING_ISSUE / PARTIALLY_ISSUED ─hold─> ON_HOLD ─resume─> (previous state)
```

| Role | Can do |
| --- | --- |
| Technician | Create/edit own drafts, submit, view own requests only, confirm receipt of own requests |
| Engineering Executive / Engineering Manager | View pending approvals, approve or reject (one decision is enough; never their own request) |
| Storekeeper | Issue queue, stock by bin, full/partial issue, hold, resume |
| Super Admin / Warehouse Admin | Create requests, view everything incl. pending approvals, issue/hold/resume; cannot approve |

Rules:
- Item code, description, and unit are copied from the Item master; requester, approver, and store keeper identities come from the signed-in user.
- Approval/rejection is a single conditional update on `status: PENDING_APPROVAL`, so the first decision wins and any later one gets 409. Rejecting needs a reason. Approval never touches stock.
- Each issue runs in one MongoDB transaction: re-reads the MR, checks status and outstanding quantities, then for every bin line re-uses the stock-movement checks (active location chain, capacity unit, available unreserved stock), deducts inventory, writes an immutable `StockMovement` (reference `MR-…/<key>/<n>`), updates issued quantities, and writes `MaterialRequestIssue` + audit. Concurrent issues conflict on the MR document and on inventory, so they cannot overdraw.
- `idempotencyKey` is unique per issue; resending the same key returns the original issue (200, `idempotent: true`) without deducting again.
- Hold requires a reason and changes no stock; resume returns to the state before the hold with all issue progress kept.
- Receipt: only the requester, any time something was issued and not yet confirmed (PARTIALLY_ISSUED, ON_HOLD, ISSUED). Each confirmation is stored in `receipts` (who, when, lines) and can never exceed issued-minus-received for a line. The request becomes RECEIVED only when it is fully ISSUED and every issued quantity is confirmed.
- MR numbers `MR-<year>-<6 digits>` come from an atomic counter (`counters` collection), safe under concurrent creates.

Models: `MaterialRequest` (header, lines with requested/issued/received, approval, hold, receipt), `MaterialRequestIssue` (each issue transaction with bins, quantities and stock movement ids), `MaterialRequestAudit` (every action with user, role, from/to status, remarks).

### API (`/api/material-requests`)

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/` | any signed-in | List (`status`, `search`, `mine=true`, `page`, `limit`); technicians see only their own |
| POST | `/` | Technician, admins | Create draft; `submit: true` creates and submits |
| GET | `/approvals` | Executive, Manager, admins | Pending approval list |
| GET | `/issue-queue` | Storekeeper, admins | Pending issue / partially issued / on hold by default; `status=ISSUED` and `startDate`/`endDate` filters |
| GET | `/:id` | requester or non-draft viewers | Details incl. `remainingQuantity` per line |
| PUT | `/:id` | requester | Edit draft |
| DELETE | `/:id` | requester | Delete draft |
| POST | `/:id/submit` | requester | Submit draft |
| POST | `/:id/approve`, `/:id/reject` | Executive, Manager | Decide (`remarks`; required to reject) |
| GET | `/:id/stock` | Storekeeper, admins | Available stock per line by bin |
| POST | `/:id/issue-full`, `/:id/issue-partial` | Storekeeper, admins | Issue (`idempotencyKey`, `allocations[]`, `remarks`) |
| POST | `/:id/hold`, `/:id/resume` | Storekeeper, admins | Hold (`reason`) / resume (`remarks`) |
| GET | `/:id/issues` | viewers | Issue history |
| POST | `/:id/receive` | requester | Confirm quantities received now (`items: [{ line, receivedQuantity }]`, `remarks`); repeatable |
| GET | `/:id/audit` | viewers | Audit trail |

Sample requests:

```json
POST /api/material-requests
{ "department": "Engineering", "workOrderNumber": "WO-5521", "remarks": "Pump P-101 overhaul",
  "items": [{ "item": "<itemId>", "requestedQuantity": 5, "remarks": "" }], "submit": true }

POST /api/material-requests/<id>/approve
{ "remarks": "Approved for WO-5521" }

POST /api/material-requests/<id>/issue-partial
{ "idempotencyKey": "3f6c1a52-8d0e-4b6f-9a51-0c2f6f0d9e11",
  "allocations": [{ "line": "<lineId>", "bin": "<binId>", "quantity": 8 }], "remarks": "Collected by Nimal" }

POST /api/material-requests/<id>/hold
{ "reason": "Waiting for VLV-50 delivery" }

POST /api/material-requests/<id>/receive
{ "items": [{ "line": "<lineId>", "receivedQuantity": 6 }], "remarks": "First box" }
```

Screens: `/material-requests` (My/All requests, Pending approval, Store issue queue), `/material-requests/new` (create or `?id=` edit draft), `/material-requests/view?id=` (details, approve/reject, issue panel with per-bin quantities and "Fill outstanding from stock", hold/resume, receipt, issue and audit history, Print layout with signature lines).

### Item availability

`GET /api/items/availability?search=&ids=&page=&limit=` (any signed-in user) returns active items with `quantity`, `reservedQuantity`, `availableQuantity` (on hand − reserved, all bins), `stockStatus` (`IN_STOCK`, `LOW_STOCK` = at or below max(minimum, reorder), `OUT_OF_STOCK`) and the primary image. An empty result means the part is not in the Item Master (different from an item with zero stock). `GET /api/items/:id/availability` adds available stock per warehouse. Read-only: technicians still get 403 on every stock-changing endpoint.

Screen: `/material-requests/availability` — search, request quantity with a warning when it exceeds stock, "Add to MR" request list, "Create material request" (pre-fills `/material-requests/new?items=id:qty,…`), and a link to a New Item Request when nothing matches.

## New Item Requests (non-stock materials)

For materials that are not in the Item Master. Workflow ends at the Engineering Executive by design:

```text
DRAFT ─submit─> PENDING_EXECUTIVE_REVIEW   (forwarding, purchasing, and Item Master creation are not implemented)
```

- Model `NewItemRequest`: number `NIR-<year>-<6 digits>`, department, requester, date, project, work order, priority (Low/Normal/High/Urgent), justification (required to submit), remarks, items (name, description, technical specification, quantity, unit, remarks, optional reference image).
- Technicians (and admins) create, edit, and delete their own drafts; submitted requests are read-only. Only the requester sees a draft. The Engineering Executive (and admins) see submitted requests; the Engineering Manager and Store Keeper have no access.
- Submitting changes nothing else: no Item Master records, no stock, no purchase documents. Actions are logged in Activity (`newItemRequest.*`).

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/new-item-requests` | creators, Executive, admins | List (`mine=true`, `status`, `search`, `page`) |
| POST | `/api/new-item-requests` | Technician, admins | Create draft (`submit: true` to submit at once) |
| GET | `/api/new-item-requests/pending` | Executive, admins | Executive review queue |
| GET | `/api/new-item-requests/similar-items?q=` | creators, Executive, admins | Possible duplicates in the Item Master |
| GET / PUT / DELETE | `/api/new-item-requests/:id` | owner (drafts); Executive/admins view submitted | Details / edit draft / delete draft |
| POST | `/api/new-item-requests/:id/submit` | owner | Submit to Engineering Executive |
| POST / DELETE | `/api/new-item-requests/:id/items/:lineId/image` | owner, draft only | Upload (field `image`, JPEG/PNG/WebP ≤ 5 MB) / remove reference image |

Screens: `/new-item-requests` (My requests, Pending executive review), `/new-item-requests/edit` (create or `?id=` edit draft, "Check Item Master" duplicate check, reference image per saved line), `/new-item-requests/view?id=`.

## Documents and printing

- `/documents/material-request?id=` and `/documents/new-item-request?id=` are paper-style pages outside the app shell, loaded from saved records only, with the same access rules as the API (others get "not found").
- The MR layout follows the paper form: company mark, MATERIAL REQUEST FORM title, Warehouse Use box (Pu001 / Rev:02, Work Order No., Date), Department and No., item table (Part No., Image, Description, Unit, Qty Requested, Qty Issued, Qty Remaining, Remark) padded to 10 rows, and Approved / Store Keeper / Received boxes filled only with recorded approval, issue, hold, and receipt data, plus blank signature lines (no generated signatures).
- Watermarks: DRAFT, NOT APPROVED (pending approval), REJECTED. The New Item Request document shows DRAFT for drafts and "Pending review" in the Executive box.
- A4 portrait by default (landscape toggle), 10 mm margins, repeated table headers, rows never split, long text wraps, images keep aspect ratio and missing ones show "—"/"No image". "Print / Save as PDF" waits for images, then opens the browser print dialog. A print timestamp is added when printing. Viewing or printing never changes a record.
- Branding: `NEXT_PUBLIC_COMPANY_NAME` / `NEXT_PUBLIC_COMPANY_TAGLINE` (default Flexicare / TOTAL QUALITY · TOTAL CARE). Put the real logo at `frontend/public/company-logo.png` to print it instead of the text mark.
