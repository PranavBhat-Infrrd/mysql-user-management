# MySQL User Management

A web UI for managing MySQL users, roles, and database access across multiple environments.

## Setup

1. Copy `.env.example` to `.env` and fill in your database connection details:
   ```bash
   cp .env.example .env
   ```

2. Install dependencies:
   ```bash
   npm run install:all
   ```

3. Start in development mode:
   ```bash
   npm run dev
   ```

   - Frontend: http://localhost:3002
   - Backend API: http://localhost:3003

## Docker

**Build the image:**
```bash
docker build -t mysql-user-mgmt .
```

**Run with your `.env` file:**
```bash
docker run -p 3003:3003 \
  -v $(pwd)/.env:/app/.env \
  --name mysql-user-mgmt \
  mysql-user-mgmt
```

Open http://localhost:3003 in your browser.

> The `.env` file is mounted as a volume (not baked into the image) so your credentials stay out of the container image.
