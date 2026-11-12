# Engineering Warehouse WMS

Warehouse management system for engineering stores: item master, Warehouse → Zone → Rack → Level → Bin locations, inventory, stock movements, alerts, reports, and role-based users.

| Part | Stack | URL |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS v4, Lucide, TanStack Table, Recharts | http://localhost:3000 |
| Backend | Node.js 24, Express 5 (ES modules), Mongoose 9, JWT, bcrypt, Helmet, Multer, ExcelJS | http://localhost:4000/api |
| Database | MongoDB **replica set** (required for stock transactions) | mongodb://127.0.0.1:27017 |

See `docs/ARCHITECTURE.md` for the design, API list, roles, and workflows, and `docs/IMPLEMENTATION-PROGRESS.md` for status and known issues.

## 1. MongoDB replica set (one-time, non-destructive)

Stock movements and reservations use MongoDB transactions, which need a replica set. A single-node replica set works with your existing data; nothing is deleted.

Windows service install (default `C:\Program Files\MongoDB\Server\<version>\bin\mongod.cfg`):

1. Open `mongod.cfg` as Administrator and add:
   ```yaml
   replication:
     replSetName: rs0
   ```
2. Restart the service (PowerShell as Administrator): `Restart-Service MongoDB`
3. Initialise once: `mongosh --eval "rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] })"`
4. Check: `mongosh --eval "rs.status().ok"` prints `1`.
5. Add `?replicaSet=rs0` to `MONGODB_URI` in `backend/.env`.

Without this, reads work but every stock movement returns *503 "Stock movements require MongoDB replica set"*.

## 2. Backend

```powershell
cd backend
Copy-Item .env.example .env   # only if you do not already have a .env; then edit the values
npm install
npm run dev                   # or: npm start
```

First administrator (only works while the user collection is empty):

```powershell
$body = @{ fullName = "Your Name"; email = "you@company.com"; password = "a-strong-password" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/auth/bootstrap -Headers @{ "x-setup-token" = "<INITIAL_ADMIN_SETUP_TOKEN>" } -ContentType "application/json" -Body $body
```

Tests:

```powershell
npm test                                  # unit/security tests, no database needed
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/engineering_wms_test?replicaSet=rs0"
npm run test:integration                  # full API workflow; uses and drops ONLY the *_test database
```

## 3. Frontend

```powershell
cd frontend
npm install
npm run dev        # development
npm run lint
npm run build      # production build
npm start          # serve the production build on :3000
```

`frontend/.env.local` needs `NEXT_PUBLIC_API_URL=http://localhost:4000/api` (already present). Sign in at http://localhost:3000/login.

## Production notes

- Serve the frontend over HTTPS; the session cookie is `Secure` when `NODE_ENV=production`.
- Set a long random `JWT_SECRET`, and set `CLIENT_ORIGIN` to the public frontend origin.
- Keep the backend reachable only from the Next.js server (for example bind it to localhost or a private network); browsers talk to Next.js only.
- Back up `backend/uploads/` (item images) together with the database.
