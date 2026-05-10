const BASE = "/api";

async function request(url, options = {}) {
  const res = await fetch(BASE + url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (url.startsWith("/export") && res.ok) return res;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Connections
export const getConnections = () => request("/connections");
export const connectTo = (name) =>
  request("/connect", { method: "POST", body: JSON.stringify({ name }) });
export const getStatus = () => request("/status");
export const disconnectDb = () => request("/disconnect", { method: "POST" });
export const addConnection = (data) =>
  request("/connections", { method: "POST", body: JSON.stringify(data) });

// Databases
export const getDatabases = () => request("/databases");

// Users & Roles
export const getUsers = () => request("/users");
export const getRoles = () => request("/roles");
export const getUser = (user, host) =>
  request(`/users/${encodeURIComponent(user)}/${encodeURIComponent(host)}`);
export const createUser = (data) =>
  request("/users", { method: "POST", body: JSON.stringify(data) });
export const dropUser = (user, host) =>
  request(`/users/${encodeURIComponent(user)}/${encodeURIComponent(host)}`, { method: "DELETE" });
export const updateUser = (user, host, data) =>
  request(`/users/${encodeURIComponent(user)}/${encodeURIComponent(host)}`, { method: "PUT", body: JSON.stringify(data) });
export const updateMemberships = (user, host, data) =>
  request(`/users/${encodeURIComponent(user)}/${encodeURIComponent(host)}/memberships`, { method: "POST", body: JSON.stringify(data) });

// Database access
export const getUserAccess = (user, host) =>
  request(`/users/${encodeURIComponent(user)}/${encodeURIComponent(host)}/access`);
export const grantAccess = (user, host, type, databases) =>
  request(`/users/${encodeURIComponent(user)}/${encodeURIComponent(host)}/grant`, { method: "POST", body: JSON.stringify({ type, databases }) });
export const revokeAccess = (user, host, databases) =>
  request(`/users/${encodeURIComponent(user)}/${encodeURIComponent(host)}/revoke`, { method: "POST", body: JSON.stringify({ databases }) });

// Export
export const exportData = (type, names) =>
  request(`/export/${type}`, { method: "POST", body: JSON.stringify({ names }) });
