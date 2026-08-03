const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const { getPool, getCurrentName, getCurrentConfig, connect, disconnect, withScopedConnection } = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3003;
const ENV_PATH = path.resolve(__dirname, "../.env");

// ─── Helpers ───
function ident(name) {
  return "`" + name.replace(/`/g, "``") + "`";
}

function userIdent(user, host) {
  return `'${user.replace(/'/g, "\\'")}'@'${host.replace(/'/g, "\\'")}'`;
}

// Runs a query against any mysql2 promise connection/pool (the active pool,
// or a short-lived scoped connection opened for a cross-environment request).
async function runQuery(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

async function query(sql, params = []) {
  const pool = getPool();
  if (!pool) throw new Error("Not connected to any database");
  return runQuery(pool, sql, params);
}

// Creates a user (+ optional privileges/lock/role memberships) on the given
// connection. Shared by the single active-connection create route and the
// cross-environment create route so both stay in sync.
async function createUserOnConn(conn, { user, host, password, superPriv, createDbPriv, createUserPriv, accountLocked, memberOf }) {
  if (!user) throw new Error("user is required");
  const h = host || "%";
  const ui = userIdent(user, h);

  if (password) await runQuery(conn, `CREATE USER ${ui} IDENTIFIED BY ?`, [password]);
  else await runQuery(conn, `CREATE USER ${ui}`);

  if (superPriv)      await runQuery(conn, `GRANT SUPER ON *.* TO ${ui}`);
  if (createDbPriv)   await runQuery(conn, `GRANT CREATE ON *.* TO ${ui}`);
  if (createUserPriv) await runQuery(conn, `GRANT CREATE USER ON *.* TO ${ui}`);
  if (accountLocked)  await runQuery(conn, `ALTER USER ${ui} ACCOUNT LOCK`);

  if (memberOf && memberOf.length) {
    for (const role of memberOf) {
      const [roleUser, roleHost] = role.split("@");
      await runQuery(conn, `GRANT ${userIdent(roleUser, roleHost || "%")} TO ${ui}`);
    }
  }

  return { user, host: h };
}

// Applies (or revokes) database-level access for a user on the given connection.
// type is "readonly", "readwrite", or "revoke". Shared by the single
// active-connection grant/revoke routes and the cross-environment update route.
async function applyAccessOnConn(conn, user, host, type, databases) {
  const ui = userIdent(user, host);
  for (const db of databases) {
    const d = ident(db);
    await runQuery(conn, `REVOKE ALL PRIVILEGES ON ${d}.* FROM ${ui}`).catch(() => {});
    if (type === "readwrite") {
      await runQuery(conn, `GRANT SELECT, INSERT, UPDATE, DELETE ON ${d}.* TO ${ui}`);
    } else if (type === "readonly") {
      await runQuery(conn, `GRANT SELECT ON ${d}.* TO ${ui}`);
    }
    // type === "revoke" — the REVOKE ALL above already covers it, nothing more to grant
  }
}

// System accounts to exclude
const SYSTEM_USERS = ["mysql.sys", "mysql.infoschema", "mysql.session", ""];

// Reads CONN_<NAME>_<FIELD> connections from the .env file (local dev, where
// "+ Add Connection" appends to that same file) and merges in any of the same
// pattern already present in process.env (Kubernetes, where secrets arrive as
// injected env vars -- there's no .env file to read there at all). File-based
// entries win on conflict since only local dev ever has both sources at once.
function parseConnections() {
  const conns = {};

  for (const [key, val] of Object.entries(process.env)) {
    const match = key.match(/^CONN_(.+?)_(HOST|PORT|USER|PASSWORD)$/);
    if (match) {
      const name = match[1];
      const field = match[2].toLowerCase();
      if (!conns[name]) conns[name] = {};
      conns[name][field] = val;
    }
  }

  let raw = "";
  try { raw = fs.readFileSync(ENV_PATH, "utf-8"); } catch { return conns; }
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIndex = trimmed.indexOf("=");
    const key = trimmed.substring(0, eqIndex).trim();
    const val = trimmed.substring(eqIndex + 1).trim();
    const match = key.match(/^CONN_(.+?)_(HOST|PORT|USER|PASSWORD)$/);
    if (match) {
      const name = match[1];
      const field = match[2].toLowerCase();
      if (!conns[name]) conns[name] = {};
      conns[name][field] = val;
    }
  }
  return conns;
}

// ════════════════════════════════════════════════════════════════
//  CONNECTIONS
// ════════════════════════════════════════════════════════════════

app.get("/api/connections", (req, res) => {
  const conns = parseConnections();
  const safe = {};
  for (const [name, cfg] of Object.entries(conns)) {
    safe[name] = { host: cfg.host || "", port: cfg.port || "3306", user: cfg.user || "" };
  }
  res.json(safe);
});

app.post("/api/connect", async (req, res) => {
  try {
    const { name } = req.body;
    const conns = parseConnections();
    const cfg = conns[name];
    if (!cfg) return res.status(400).json({ error: `Connection "${name}" not found in .env` });
    const info = await connect(name, cfg);
    res.json({ connected: true, ...info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/status", (req, res) => {
  const name = getCurrentName();
  if (!name) return res.json({ connected: false });
  const conns = parseConnections();
  const cfg = conns[name];
  res.json({ connected: true, name, host: cfg?.host || "", port: cfg?.port || "" });
});

app.post("/api/disconnect", async (req, res) => {
  await disconnect();
  res.json({ connected: false });
});

app.post("/api/connections", (req, res) => {
  try {
    const { name, host, port, user, password } = req.body;
    if (!name || !host || !user)
      return res.status(400).json({ error: "name, host, user are required" });
    const conns = parseConnections();
    if (conns[name])
      return res.status(400).json({ error: `Connection "${name}" already exists` });
    const block = `
# ${name} server
CONN_${name}_HOST=${host}
CONN_${name}_PORT=${port || "3306"}
CONN_${name}_USER=${user}
CONN_${name}_PASSWORD=${password || ""}
`;
    fs.appendFileSync(ENV_PATH, block);
    res.json({ success: true, message: `Connection "${name}" added to .env` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  DATABASES
// ════════════════════════════════════════════════════════════════

app.get("/api/databases", async (req, res) => {
  try {
    const rows = await query(
      `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME NOT IN ('mysql','information_schema','performance_schema','sys')
       ORDER BY SCHEMA_NAME`
    );
    res.json(rows.map((r) => r.SCHEMA_NAME));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  USERS  (account_locked = N)
// ════════════════════════════════════════════════════════════════

app.get("/api/users", async (req, res) => {
  try {
    const rows = await query(
      `SELECT User, Host, Super_priv, Create_priv, Create_user_priv,
              account_locked, password_expired
       FROM mysql.user
       WHERE User NOT IN (${SYSTEM_USERS.map(() => "?").join(",")})
         AND account_locked = 'N'
       ORDER BY User, Host`,
      SYSTEM_USERS
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  ROLES  (account_locked = Y — created via CREATE ROLE)
// ════════════════════════════════════════════════════════════════

app.get("/api/roles", async (req, res) => {
  try {
    const rows = await query(
      `SELECT User, Host, Super_priv, Create_priv, Create_user_priv,
              account_locked, password_expired
       FROM mysql.user
       WHERE User NOT IN (${SYSTEM_USERS.map(() => "?").join(",")})
         AND account_locked = 'Y'
         AND password_expired = 'Y'
       ORDER BY User, Host`,
      SYSTEM_USERS
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get detailed user/role info including memberships
app.get("/api/users/:user/:host", async (req, res) => {
  try {
    const { user, host } = req.params;
    const rows = await query(
      `SELECT User, Host, Super_priv, Create_priv, Create_user_priv,
              account_locked, password_expired
       FROM mysql.user WHERE User = ? AND Host = ?`,
      [user, host]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    // Roles this user is member of
    let memberOf = [];
    let members = [];
    try {
      const moRows = await query(
        `SELECT FROM_USER, FROM_HOST FROM mysql.role_edges WHERE TO_USER = ? AND TO_HOST = ?`,
        [user, host]
      );
      memberOf = moRows.map((r) => `${r.FROM_USER}@${r.FROM_HOST}`);

      const memRows = await query(
        `SELECT TO_USER, TO_HOST FROM mysql.role_edges WHERE FROM_USER = ? AND FROM_HOST = ?`,
        [user, host]
      );
      members = memRows.map((r) => `${r.TO_USER}@${r.TO_HOST}`);
    } catch {
      // role_edges may not exist on older MySQL versions
    }

    res.json({ ...rows[0], memberOf, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create user
app.post("/api/users", async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) throw new Error("Not connected to any database");
    const { user, host } = await createUserOnConn(pool, req.body);
    res.json({ success: true, message: `User "${user}"@"${host}" created` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update user attributes
app.put("/api/users/:user/:host", async (req, res) => {
  try {
    const { user, host } = req.params;
    const { password, superPriv, createDbPriv, createUserPriv, accountLocked } = req.body;
    const ui = userIdent(user, host);

    if (password) await query(`ALTER USER ${ui} IDENTIFIED BY ?`, [password]);

    // SUPER
    if (superPriv) await query(`GRANT SUPER ON *.* TO ${ui}`);
    else await query(`REVOKE SUPER ON *.* FROM ${ui}`).catch(() => {});

    // CREATE (databases)
    if (createDbPriv) await query(`GRANT CREATE ON *.* TO ${ui}`);
    else await query(`REVOKE CREATE ON *.* FROM ${ui}`).catch(() => {});

    // CREATE USER
    if (createUserPriv) await query(`GRANT CREATE USER ON *.* TO ${ui}`);
    else await query(`REVOKE CREATE USER ON *.* FROM ${ui}`).catch(() => {});

    // Account lock
    if (accountLocked) await query(`ALTER USER ${ui} ACCOUNT LOCK`);
    else await query(`ALTER USER ${ui} ACCOUNT UNLOCK`);

    res.json({ success: true, message: `User "${user}"@"${host}" updated` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Drop user / role
app.delete("/api/users/:user/:host", async (req, res) => {
  try {
    const { user, host } = req.params;
    await query(`DROP USER ${userIdent(user, host)}`);
    res.json({ success: true, message: `Dropped "${user}"@"${host}"` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update memberships
app.post("/api/users/:user/:host/memberships", async (req, res) => {
  try {
    const { user, host } = req.params;
    const { addMemberOf = [], removeMemberOf = [], addMembers = [], removeMembers = [] } = req.body;
    const ui = userIdent(user, host);

    for (const role of addMemberOf) {
      const [ru, rh] = role.split("@");
      await query(`GRANT ${userIdent(ru, rh || "%")} TO ${ui}`);
    }
    for (const role of removeMemberOf) {
      const [ru, rh] = role.split("@");
      await query(`REVOKE ${userIdent(ru, rh || "%")} FROM ${ui}`);
    }
    for (const member of addMembers) {
      const [mu, mh] = member.split("@");
      await query(`GRANT ${ui} TO ${userIdent(mu, mh || "%")}`);
    }
    for (const member of removeMembers) {
      const [mu, mh] = member.split("@");
      await query(`REVOKE ${ui} FROM ${userIdent(mu, mh || "%")}`);
    }

    res.json({ success: true, message: "Memberships updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  DATABASE ACCESS
// ════════════════════════════════════════════════════════════════

app.get("/api/users/:user/:host/access", async (req, res) => {
  try {
    const { user, host } = req.params;

    // All non-system databases
    const dbRows = await query(
      `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME NOT IN ('mysql','information_schema','performance_schema','sys')
       ORDER BY SCHEMA_NAME`
    );
    const dbNames = dbRows.map((r) => r.SCHEMA_NAME);

    // Privileges granted to this user per database
    const grantee = `'${user}'@'${host}'`;
    const privRows = await query(
      `SELECT TABLE_SCHEMA, PRIVILEGE_TYPE
       FROM information_schema.SCHEMA_PRIVILEGES
       WHERE GRANTEE = ?
       ORDER BY TABLE_SCHEMA`,
      [grantee]
    );

    const databases = {};
    for (const db of dbNames) {
      const privs = privRows.filter((r) => r.TABLE_SCHEMA === db).map((r) => r.PRIVILEGE_TYPE);
      if (privs.includes("SELECT") && (privs.includes("INSERT") || privs.includes("UPDATE") || privs.includes("DELETE"))) {
        databases[db] = "readwrite";
      } else if (privs.includes("SELECT")) {
        databases[db] = "readonly";
      } else {
        databases[db] = "none";
      }
    }

    res.json({ databases });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Grant access on specific databases
app.post("/api/users/:user/:host/grant", async (req, res) => {
  try {
    const { user, host } = req.params;
    const { type, databases } = req.body;
    if (!databases || !databases.length) return res.status(400).json({ error: "databases required" });
    const pool = getPool();
    if (!pool) throw new Error("Not connected to any database");

    await applyAccessOnConn(pool, user, host, type, databases);

    const label = type === "readwrite" ? "Read & Write" : "Read Only";
    res.json({ success: true, message: `Granted ${label} on: ${databases.join(", ")}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke access on specific databases
app.post("/api/users/:user/:host/revoke", async (req, res) => {
  try {
    const { user, host } = req.params;
    const { databases } = req.body;
    if (!databases || !databases.length) return res.status(400).json({ error: "databases required" });
    const pool = getPool();
    if (!pool) throw new Error("Not connected to any database");

    await applyAccessOnConn(pool, user, host, "revoke", databases);
    res.json({ success: true, message: `Revoked access on: ${databases.join(", ")}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  EXPORT
// ════════════════════════════════════════════════════════════════

app.post("/api/export/:type", async (req, res) => {
  try {
    const type = req.params.type;
    const { names } = req.body; // ["user@host", ...]
    if (!names || !names.length) return res.status(400).json({ error: "No names selected" });

    const pairs = names.map((n) => {
      const atIdx = n.lastIndexOf("@");
      return [n.substring(0, atIdx), n.substring(atIdx + 1)];
    });

    const locked = type === "roles" ? "'Y'" : "'N'";
    const placeholders = pairs.map(() => "(User = ? AND Host = ?)").join(" OR ");
    const params = pairs.flat();

    const rows = await query(
      `SELECT User, Host, Super_priv, Create_priv, Create_user_priv, account_locked, password_expired
       FROM mysql.user
       WHERE account_locked = ${locked} AND (${placeholders})
       ORDER BY User, Host`,
      params
    );

    if (!rows.length) return res.status(404).json({ error: "No data to export" });

    const headers = Object.keys(rows[0]);
    const csvLines = [headers.join(",")];
    for (const row of rows) {
      csvLines.push(headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(","));
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${type}_export.csv`);
    res.send(csvLines.join("\n"));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  CROSS-ENVIRONMENT USER SEARCH & UPDATE
//  These endpoints open short-lived connections scoped to a specific named
//  connection from .env, independent of the pool/connection above. This lets
//  us search/update a user in ANY configured environment without disturbing
//  whichever connection the rest of the app currently has active.
// ════════════════════════════════════════════════════════════════

// Search for an exact username across ALL configured connections (.env)
app.get("/api/search-user", async (req, res) => {
  try {
    const username = (req.query.username || "").trim();
    if (!username) return res.status(400).json({ error: "username query param is required" });

    const conns = parseConnections();
    const connectionName = (req.query.connectionName || "").trim();
    const names = connectionName ? [connectionName] : Object.keys(conns);
    if (connectionName && !conns[connectionName]) {
      return res.status(404).json({ error: `Connection "${connectionName}" not found` });
    }

    const results = await Promise.all(names.map(async (name) => {
      const cfg = conns[name];
      try {
        const rows = await withScopedConnection(cfg, async (conn) => {
          const [rows] = await conn.query(
            `SELECT User, Host, Super_priv, Create_priv, Create_user_priv,
                    account_locked, password_expired
             FROM mysql.user WHERE User = ?`,
            [username]
          );
          return rows;
        });
        return { connectionName: name, host: cfg.host, matches: rows, error: null };
      } catch (err) {
        return { connectionName: name, host: cfg.host, matches: [], error: err.message || String(err) };
      }
    }));

    res.json({ username, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List databases for one specific named connection (cross-env db picker, used by
// the "Update access" cross-env panel and the create-user-cross-env db picker)
app.get("/api/databases-cross-env", async (req, res) => {
  try {
    const connectionName = (req.query.connectionName || "").trim();
    if (!connectionName) return res.status(400).json({ error: "connectionName query param is required" });

    const conns = parseConnections();
    const cfg = conns[connectionName];
    if (!cfg) return res.status(404).json({ error: `Connection "${connectionName}" not found` });

    const names = await withScopedConnection(cfg, async (conn) => {
      const rows = await runQuery(
        conn,
        `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
         WHERE SCHEMA_NAME NOT IN ('mysql','information_schema','performance_schema','sys')
         ORDER BY SCHEMA_NAME`
      );
      return rows.map((r) => r.SCHEMA_NAME);
    });

    res.json(names);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a user's password/attributes/database-access in one or more specific named
// connections, independent of whichever connection is currently active in the app.
// Each target is updated via its own connection, so one failure doesn't block the others.
app.post("/api/update-user-cross-env", async (req, res) => {
  try {
    const { targets, username, updateType, password, attributes, access } = req.body;

    if (!username) return res.status(400).json({ error: "Username is required" });
    if (!["password", "attributes", "access"].includes(updateType))
      return res.status(400).json({ error: "Invalid updateType" });
    if (updateType === "password" && !password)
      return res.status(400).json({ error: "Password is required" });

    const conns = parseConnections();

    // Access mode: each selected database carries its own list of target
    // environments (a database can be scoped to a subset of the overall
    // selection, e.g. grant "titanDB" only to PROD while other databases
    // still go to every environment). Group by target first so a single
    // connectionName+host pair that appears in multiple databases only opens
    // one scoped connection instead of one per database.
    if (updateType === "access") {
      if (!access || !["readonly", "readwrite", "revoke"].includes(access.type))
        return res.status(400).json({ error: "Invalid access type" });
      if (!Array.isArray(access.groups) || access.groups.length === 0)
        return res.status(400).json({ error: "At least one database selection is required" });
      for (const g of access.groups) {
        if (!g.database || !Array.isArray(g.targets) || g.targets.length === 0)
          return res.status(400).json({ error: "Each selection must have a database and at least one target environment" });
      }

      const byTarget = {}; // key `${connectionName}|${host}` -> { connectionName, host, databases: Set }
      for (const g of access.groups) {
        for (const t of g.targets) {
          const key = `${t.connectionName}|${t.host}`;
          if (!byTarget[key]) byTarget[key] = { connectionName: t.connectionName, host: t.host, databases: new Set() };
          byTarget[key].databases.add(g.database);
        }
      }

      const results = await Promise.all(Object.values(byTarget).map(async (t) => {
        const cfg = conns[t.connectionName];
        if (!cfg) return { connectionName: t.connectionName, host: t.host, success: false, message: `Connection "${t.connectionName}" not found` };
        try {
          await withScopedConnection(cfg, (conn) => applyAccessOnConn(conn, username, t.host, access.type, [...t.databases]));
          return { connectionName: t.connectionName, host: t.host, success: true, message: `Updated access on: ${[...t.databases].join(", ")}` };
        } catch (err) {
          return { connectionName: t.connectionName, host: t.host, success: false, message: err.message || String(err) };
        }
      }));

      return res.json({ success: true, results });
    }

    // Password/attributes mode: applies uniformly to every selected target environment.
    if (!Array.isArray(targets) || targets.length === 0)
      return res.status(400).json({ error: "At least one target environment is required" });

    const results = await Promise.all(targets.map(async (target) => {
      const cfg = conns[target.connectionName];
      const host = target.host;
      if (!cfg) {
        return { connectionName: target.connectionName, host, success: false, message: `Connection "${target.connectionName}" not found` };
      }
      const ui = userIdent(username, host);
      try {
        await withScopedConnection(cfg, async (conn) => {
          if (updateType === "password") {
            await runQuery(conn, `ALTER USER ${ui} IDENTIFIED BY ?`, [password]);
          } else {
            const { superPriv, createDbPriv, createUserPriv, accountLocked } = attributes || {};
            if (superPriv) await runQuery(conn, `GRANT SUPER ON *.* TO ${ui}`);
            else await runQuery(conn, `REVOKE SUPER ON *.* FROM ${ui}`).catch(() => {});

            if (createDbPriv) await runQuery(conn, `GRANT CREATE ON *.* TO ${ui}`);
            else await runQuery(conn, `REVOKE CREATE ON *.* FROM ${ui}`).catch(() => {});

            if (createUserPriv) await runQuery(conn, `GRANT CREATE USER ON *.* TO ${ui}`);
            else await runQuery(conn, `REVOKE CREATE USER ON *.* FROM ${ui}`).catch(() => {});

            if (accountLocked) await runQuery(conn, `ALTER USER ${ui} ACCOUNT LOCK`);
            else await runQuery(conn, `ALTER USER ${ui} ACCOUNT UNLOCK`);
          }
        });
        return { connectionName: target.connectionName, host, success: true, message: "Updated successfully" };
      } catch (err) {
        return { connectionName: target.connectionName, host, success: false, message: err.message || String(err) };
      }
    }));

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new user in one or more specific named connections, independent of
// whichever connection is currently active in the app. Each target is created
// independently via its own connection, so one failure doesn't block the others.
app.post("/api/create-user-cross-env", async (req, res) => {
  try {
    const { connectionNames, user, host, password, superPriv, createDbPriv, createUserPriv, accountLocked, memberOf } = req.body;

    if (!Array.isArray(connectionNames) || connectionNames.length === 0)
      return res.status(400).json({ error: "At least one target environment is required" });
    if (!user) return res.status(400).json({ error: "user is required" });

    const conns = parseConnections();

    const results = await Promise.all(connectionNames.map(async (name) => {
      const cfg = conns[name];
      if (!cfg) return { connectionName: name, success: false, message: `Connection "${name}" not found` };
      try {
        const created = await withScopedConnection(cfg, (conn) =>
          createUserOnConn(conn, { user, host, password, superPriv, createDbPriv, createUserPriv, accountLocked, memberOf })
        );
        return { connectionName: name, success: true, message: `User "${created.user}"@"${created.host}" created` };
      } catch (err) {
        return { connectionName: name, success: false, message: err.message || String(err) };
      }
    }));

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  STATIC FILES (production — serves the built React client)
// ════════════════════════════════════════════════════════════════

const clientDist = path.resolve(__dirname, "../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

// ════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`MySQL User Mgmt server running on http://localhost:${PORT}`);
});
