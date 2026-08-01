const mysql = require("mysql2/promise");

let pool = null;
let currentName = null;
let currentConfig = null;

function getPool() { return pool; }
function getCurrentName() { return currentName; }
function getCurrentConfig() { return currentConfig; }

async function connect(name, cfg) {
  if (pool) {
    try { await pool.end(); } catch {}
  }

  pool = mysql.createPool({
    host: cfg.host,
    port: parseInt(cfg.port, 10) || 3306,
    user: cfg.user,
    password: cfg.password,
    database: "mysql",
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 5000,
  });

  // Test connection
  const conn = await pool.getConnection();
  conn.release();

  currentName = name;
  currentConfig = { ...cfg };
  return { name, host: cfg.host, port: cfg.port || 3306 };
}

async function disconnect() {
  if (pool) {
    try { await pool.end(); } catch {}
    pool = null;
    currentName = null;
    currentConfig = null;
  }
}

// Opens a short-lived connection to a specific (possibly non-active) server config,
// runs fn against it, and always closes it afterward. Used for cross-environment
// search/update so we don't disturb whichever connection is currently active above.
async function withScopedConnection(cfg, fn) {
  const conn = await mysql.createConnection({
    host: cfg.host,
    port: parseInt(cfg.port, 10) || 3306,
    user: cfg.user,
    password: cfg.password,
    database: "mysql",
    connectTimeout: 6000,
  });
  try {
    return await fn(conn);
  } finally {
    try { await conn.end(); } catch {}
  }
}

module.exports = { connect, disconnect, getPool, getCurrentName, getCurrentConfig, withScopedConnection };
