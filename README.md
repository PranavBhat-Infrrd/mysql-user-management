# MySQL User Management

A web UI for managing MySQL users, privileges, and database-level access (read-only / read-write / revoke) across multiple environments — without connecting to each RDS/MySQL server individually via a CLI or GUI client.

## How it works

- **Named connections, not hardcoded hosts.** Each environment is a block of `CONN_<NAME>_HOST` / `_PORT` / `_USER` / `_PASSWORD` variables in `.env`. The dropdown in the UI lists whatever is defined there (plus any added at runtime via **+ Add Connection**, which appends to `.env`).
- **One active connection at a time** for the main Users/Roles views; cross-environment actions (search, create, grant/revoke) open independent short-lived connections on demand via `withScopedConnection`, so they never disturb the connection you're actively browsing.
- **Statements are built dynamically**, not templated strings — `ident()` / `userIdent()` helpers quote identifiers safely before assembling `CREATE USER` / `GRANT` / `REVOKE` SQL.
- **No `_DATABASE` in the connection config** — MySQL user/privilege management happens at the server level (`mysql.user`), so connections only need host/port/user/password.

## Tech stack

- **Backend:** Node.js, Express 4, `mysql2`
- **Frontend:** React 18 + Vite 5 (plain JS, no build-time framework beyond Vite)
- **Dev orchestration:** `concurrently`
- **Docker:** multi-stage build — client is built first, then its output is copied into a slim Node server image

## Architecture

```
mysql-user-mgmt/
├── server/
│   ├── index.js      # Express app + all /api routes
│   └── db.js          # Connection pooling, scoped-connection helper
└── client/
    └── src/            # React + Vite SPA
```

## API reference

| Method & path | Purpose |
|---|---|
| `GET /api/connections` | List configured connections |
| `POST /api/connections` | Save a new named connection to `.env` |
| `POST /api/connect` | Switch the active connection |
| `POST /api/disconnect` | Disconnect the active connection |
| `GET /api/status` | Current connection status |
| `GET /api/databases` | List databases on the active connection |
| `GET /api/users` | List all users |
| `GET /api/roles` | List MySQL roles (if supported by the server version) |
| `GET /api/users/:user/:host` | User detail (privileges, grants) |
| `POST /api/users` | Create a new user |
| `PUT /api/users/:user/:host` | Update an existing user |
| `DELETE /api/users/:user/:host` | Drop a user |
| `POST /api/users/:user/:host/memberships` | Manage role memberships |
| `GET /api/users/:user/:host/access` | List a user's database-level access |
| `POST /api/users/:user/:host/grant` | Grant access (readonly/readwrite) to a database |
| `POST /api/users/:user/:host/revoke` | Revoke access to a database |
| `POST /api/export/:type` | Export users or roles to CSV |
| `GET /api/search-user` | Search for a username across all configured environments |
| `GET /api/databases-cross-env` | List databases for one specific (non-active) connection |
| `POST /api/update-user-cross-env` | Update a user's password/roles across several environments at once |
| `POST /api/create-user-cross-env` | Create a user in one or more named environments at once |

## Setup

```bash
cp .env.example .env
```

Fill in one block per environment:

```env
CONN_DEV_HOST=localhost
CONN_DEV_PORT=3306
CONN_DEV_USER=admin
CONN_DEV_PASSWORD=secret
```

Install dependencies:

```bash
npm run install:all
```

## Run

```bash
npm run dev
```

- Frontend: [http://localhost:3002](http://localhost:3002)
- Backend API: [http://localhost:3003](http://localhost:3003)

(`npm start` runs the same pair without `--watch`/HMR — closer to a production-ish local run.)

## Docker

```bash
docker build -t mysql-user-mgmt .
docker run -p 3003:3003 \
  -v $(pwd)/.env:/app/.env \
  --name mysql-user-mgmt \
  mysql-user-mgmt
```

Open [http://localhost:3003](http://localhost:3003). The `.env` file is mounted as a volume, not baked into the image, so credentials stay out of the container image.

## Security

- Internal/VPN use only — do not expose this service publicly; it holds live database credentials and can create/drop MySQL users.
- `.env` and `client/dist/` are both gitignored; never commit real credentials, and run `npm run build` inside `client/` to produce a fresh `dist/` before a Docker build.
