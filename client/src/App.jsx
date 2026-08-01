import { useState, useEffect, useCallback, useRef } from "react";
import * as api from "./api";

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle-label">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function DataTable({ columns, rows, actions }) {
  if (!rows.length) return <p className="empty">No data found.</p>;
  return (
    <table>
      <thead>
        <tr>
          {columns.map((c) => <th key={c.key}>{c.label}</th>)}
          {actions && <th>Actions</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((c) => (
              <td key={c.key}>{c.render ? c.render(row) : String(row[c.key] ?? "")}</td>
            ))}
            {actions && <td>{actions(row)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function App() {
  // ─── Connection state ───
  const [connections, setConnections] = useState({});
  const [selectedConn, setSelectedConn] = useState("");
  const [connected, setConnected] = useState(false);
  const [connInfo, setConnInfo] = useState(null);
  const [connError, setConnError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", host: "", port: "3306", user: "", password: "" });

  // ─── View state ───
  const [view, setView] = useState(null);
  const [tableData, setTableData] = useState([]);
  const [tableSearch, setTableSearch] = useState("");
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("success");
  const setSuccess = (m) => { setMsg(m); setMsgType("success"); };
  const setError = (m)   => { setMsg(m); setMsgType("error"); };

  // ─── Selected user / role ───
  const [selectedUser, setSelectedUser] = useState(null);

  // ─── Add user form ───
  const [userForm, setUserForm] = useState({
    user: "", host: "%", password: "",
    superPriv: false, createDbPriv: false, createUserPriv: false, accountLocked: false,
  });
  const [addUserMemberOf, setAddUserMemberOf] = useState([]);

  // ─── Edit form ───
  const [editForm, setEditForm] = useState(null);
  const [editTab, setEditTab] = useState("attributes");
  const [editMemberOf, setEditMemberOf] = useState([]);
  const [editMembers, setEditMembers] = useState([]);
  const editInitialMemberOf = useRef([]);
  const editInitialMembers = useRef([]);

  // ─── Database access ───
  const [dbAccess, setDbAccess] = useState({});

  // ─── All users+roles for membership pickers ───
  const [allRoles, setAllRoles] = useState([]);

  // ─── Export ───
  const [exportType, setExportType] = useState("users");
  const [exportList, setExportList] = useState([]);
  const [exportSelected, setExportSelected] = useState(new Set());

  // ─── Search user across environments ───
  const [searchUsername, setSearchUsername] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchStatusMsg, setSearchStatusMsg] = useState("");
  const [searchStatusType, setSearchStatusType] = useState("success"); // success | error | pending
  const [searchResults, setSearchResults] = useState([]); // one entry per configured connection
  const [searchSelected, setSearchSelected] = useState(new Set()); // keys of "connectionName|Host"
  const [crossEnvTargets, setCrossEnvTargets] = useState(null); // [{connectionName, host}] while panel is open
  const [crossEnvType, setCrossEnvType] = useState("password");
  const [crossEnvPassword, setCrossEnvPassword] = useState("");
  const [crossEnvAttrs, setCrossEnvAttrs] = useState({ superPriv: false, createDbPriv: false, createUserPriv: false, accountLocked: false });
  const [crossEnvAccessType, setCrossEnvAccessType] = useState("readonly");
  const [crossEnvDbOptions, setCrossEnvDbOptions] = useState([]);
  const [crossEnvDbLoading, setCrossEnvDbLoading] = useState(false);
  const [crossEnvDbGroups, setCrossEnvDbGroups] = useState({}); // { [database]: Set<"connectionName|host"> } — which target(s) each selected database applies to
  const [crossEnvApplying, setCrossEnvApplying] = useState(false);
  const [crossEnvResults, setCrossEnvResults] = useState([]);

  // ─── Create user across environments ───
  const [createEnvSelected, setCreateEnvSelected] = useState(new Set()); // connection names
  const [createEnvForm, setCreateEnvForm] = useState({
    user: "", host: "%", password: "",
    superPriv: false, createDbPriv: false, createUserPriv: false, accountLocked: false,
  });
  const [createEnvApplying, setCreateEnvApplying] = useState(false);
  const [createEnvResults, setCreateEnvResults] = useState([]);

  // ════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════

  const getErrorHint = (m) => {
    if (!m) return null;
    const s = m.toLowerCase();
    if (s.includes("access denied"))                            return "The connected user lacks sufficient privileges for this action.";
    if (s.includes("already exists"))                          return "A user with this name and host already exists.";
    if (s.includes("cannot drop") || s.includes("operation"))  return "Cannot drop this user — check for active connections or dependencies.";
    if (s.includes("super"))                                    return "Only users with SUPER privilege can perform this action.";
    if (s.includes("password"))                                 return "The password is invalid or does not meet server requirements.";
    if (s.includes("does not exist") || s.includes("unknown")) return "The specified user or role was not found.";
    if (s.includes("not connected"))                            return "No active connection. Please connect first.";
    if (s.includes("grant") || s.includes("revoke"))           return "Check that the database exists and the connected user has GRANT OPTION.";
    return "Check the MySQL error log for more details.";
  };

  // ════════════════════════════════════════
  //  CONNECTIONS
  // ════════════════════════════════════════

  const loadConnections = useCallback(async () => {
    try {
      const conns = await api.getConnections();
      setConnections(conns);
      const keys = Object.keys(conns);
      if (keys.length && !selectedConn) setSelectedConn(keys[0]);
    } catch (err) {
      setConnError(err.message);
    }
  }, []);

  useEffect(() => {
    loadConnections();
    api.getStatus().then((s) => {
      if (s.connected) {
        setConnected(true);
        setConnInfo(s);
        setSelectedConn(s.name);
      }
    });
  }, [loadConnections]);

  const handleConnect = async () => {
    if (!selectedConn) return;
    setConnecting(true);
    setConnError("");
    try {
      const info = await api.connectTo(selectedConn);
      setConnected(true);
      setConnInfo(info);
      setView(null);
      setTableData([]);
      setMsg("");
    } catch (err) {
      setConnError(err.message);
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    await api.disconnectDb();
    setConnected(false);
    setConnInfo(null);
    setView(null);
    setTableData([]);
    setMsg("");
  };

  const handleAddConnection = async () => {
    setConnError("");
    try {
      if (!addForm.name || !addForm.host || !addForm.user) {
        setConnError("Name, Host, and User are required");
        return;
      }
      await api.addConnection(addForm);
      setShowAddForm(false);
      setAddForm({ name: "", host: "", port: "3306", user: "", password: "" });
      await loadConnections();
      setSelectedConn(addForm.name);
    } catch (err) {
      setConnError(err.message);
    }
  };

  // ════════════════════════════════════════
  //  VIEW USERS / ROLES
  // ════════════════════════════════════════

  const handleViewUsers = async () => {
    setView("users");
    setTableSearch("");
    setMsg("");
    try { setTableData(await api.getUsers()); }
    catch (err) { setError(err.message); }
  };

  const handleViewRoles = async () => {
    setView("roles");
    setTableSearch("");
    setMsg("");
    try { setTableData(await api.getRoles()); }
    catch (err) { setError(err.message); }
  };

  const loadAllRoles = async () => {
    try {
      const [users, roles] = await Promise.all([api.getUsers(), api.getRoles()]);
      setAllRoles([
        ...users.map((u) => ({ label: `${u.User}@${u.Host}`, value: `${u.User}@${u.Host}`, isRole: false })),
        ...roles.map((r) => ({ label: `${r.User}@${r.Host}`, value: `${r.User}@${r.Host}`, isRole: true })),
      ]);
    } catch {}
  };

  // ════════════════════════════════════════
  //  ADD USER
  // ════════════════════════════════════════

  const handleShowAddUser = () => {
    setView("adduser");
    setMsg("");
    setAddUserMemberOf([]);
    loadAllRoles();
  };

  const handleCreateUser = async () => {
    setMsg("");
    try {
      const res = await api.createUser({ ...userForm, memberOf: addUserMemberOf });
      setSuccess(res.message);
      setUserForm({ user: "", host: "%", password: "", superPriv: false, createDbPriv: false, createUserPriv: false, accountLocked: false });
      setAddUserMemberOf([]);
    } catch (err) {
      setError(err.message);
    }
  };

  // ════════════════════════════════════════
  //  MANAGE / EDIT
  // ════════════════════════════════════════

  const handleOpenManage = async (row) => {
    setSelectedUser(row);
    setView("edit-role");
    setEditTab("attributes");
    setEditForm(null);
    setMsg("");

    try {
      const details = await api.getUser(row.User, row.Host);
      setEditForm({
        password: "",
        superPriv: details.Super_priv === "Y",
        createDbPriv: details.Create_priv === "Y",
        createUserPriv: details.Create_user_priv === "Y",
        accountLocked: details.account_locked === "Y",
      });
      editInitialMemberOf.current = details.memberOf;
      editInitialMembers.current  = details.members;
      setEditMemberOf([...details.memberOf]);
      setEditMembers([...details.members]);
    } catch (err) { setError(err.message); }

    loadAllRoles();

    try {
      const res = await api.getUserAccess(row.User, row.Host);
      setDbAccess(res.databases || {});
    } catch { setDbAccess({}); }
  };

  const handleSaveEdit = async () => {
    setMsg("");
    try {
      await api.updateUser(selectedUser.User, selectedUser.Host, editForm);

      const addMemberOf    = editMemberOf.filter((r) => !editInitialMemberOf.current.includes(r));
      const removeMemberOf = editInitialMemberOf.current.filter((r) => !editMemberOf.includes(r));
      const addMembers     = editMembers.filter((r) => !editInitialMembers.current.includes(r));
      const removeMembers  = editInitialMembers.current.filter((r) => !editMembers.includes(r));

      if (addMemberOf.length || removeMemberOf.length || addMembers.length || removeMembers.length) {
        await api.updateMemberships(selectedUser.User, selectedUser.Host, { addMemberOf, removeMemberOf, addMembers, removeMembers });
      }

      editInitialMemberOf.current = [...editMemberOf];
      editInitialMembers.current  = [...editMembers];
      setEditForm({ ...editForm, password: "" });
      setSuccess(`User "${selectedUser.User}"@"${selectedUser.Host}" updated`);
    } catch (err) { setError(err.message); }
  };

  // ════════════════════════════════════════
  //  DATABASE ACCESS
  // ════════════════════════════════════════

  const handleGrantAccess = async (type, databases) => {
    setMsg("");
    try {
      const res = await api.grantAccess(selectedUser.User, selectedUser.Host, type, databases);
      setSuccess(res.message);
      const updated = { ...dbAccess };
      for (const d of databases) updated[d] = type;
      setDbAccess(updated);
    } catch (err) { setError(err.message); }
  };

  const handleRevokeAccess = async (databases) => {
    if (!confirm(`Revoke access for "${selectedUser.User}"@"${selectedUser.Host}" on: ${databases.join(", ")}?`)) return;
    setMsg("");
    try {
      const res = await api.revokeAccess(selectedUser.User, selectedUser.Host, databases);
      setSuccess(res.message);
      const updated = { ...dbAccess };
      for (const d of databases) updated[d] = "none";
      setDbAccess(updated);
    } catch (err) { setError(err.message); }
  };

  // ════════════════════════════════════════
  //  DROP
  // ════════════════════════════════════════

  const handleDrop = async (row) => {
    if (!confirm(`Drop "${row.User}"@"${row.Host}"?`)) return;
    setMsg("");
    try {
      const res = await api.dropUser(row.User, row.Host);
      setSuccess(res.message);
      if (view === "users") handleViewUsers();
      if (view === "roles") handleViewRoles();
    } catch (err) { setError(err.message); }
  };

  // ════════════════════════════════════════
  //  EXPORT
  // ════════════════════════════════════════

  const handleOpenExport = async (type) => {
    setExportType(type);
    setExportSelected(new Set());
    setView("export-select");
    setMsg("");
    try {
      const data = type === "users" ? await api.getUsers() : await api.getRoles();
      setExportList(data);
    } catch (err) { setError(err.message); }
  };

  const toggleExportItem = (id) => {
    setExportSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDownloadExport = async () => {
    setMsg("");
    try {
      const names = [...exportSelected];
      const res = await api.exportData(exportType, names);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${connInfo?.name || "mysql"}_${exportType}_export.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess(`Exported ${names.length} ${exportType} to CSV`);
    } catch (err) { setError(err.message); }
  };

  // ════════════════════════════════════════
  //  SEARCH USER ACROSS ENVIRONMENTS
  // ════════════════════════════════════════

  const rowKey = (connectionName, host) => `${connectionName}|${host}`;

  const handleShowSearchUser = () => {
    setView("search-user");
    setMsg("");
    setSearchUsername("");
    setSearchStatusMsg("");
    setSearchResults([]);
    setSearchSelected(new Set());
    setCrossEnvTargets(null);
  };

  const fetchSearchResults = async (username) => {
    const data = await api.searchUserAcrossEnvs(username);
    const results = data.results || [];
    setSearchResults(results);
    const foundCount = results.reduce((n, r) => n + (r.matches?.length || 0), 0);
    setSearchStatusType(foundCount === 0 ? "error" : "success");
    setSearchStatusMsg(
      foundCount === 0
        ? `No user "${username}" found in any environment.`
        : `Found "${username}" in ${foundCount} location(s) across ${results.length} environment(s).`
    );
  };

  const runSearchUser = async () => {
    const username = searchUsername.trim();
    if (!username) {
      setSearchStatusType("error");
      setSearchStatusMsg("Please enter a username");
      return;
    }
    setSearching(true);
    setSearchStatusType("pending");
    setSearchStatusMsg("Searching across all configured environments...");
    setSearchSelected(new Set());
    setCrossEnvTargets(null);
    try {
      await fetchSearchResults(username);
    } catch (err) {
      setSearchStatusType("error");
      setSearchStatusMsg(err.message);
    }
    setSearching(false);
  };

  const toggleSearchRow = (connectionName, host) => {
    setSearchSelected((prev) => {
      const next = new Set(prev);
      const key = rowKey(connectionName, host);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const allSearchRowKeys = () =>
    searchResults.flatMap((r) => (r.matches || []).map((m) => rowKey(r.connectionName, m.Host)));

  const toggleSearchSelectAll = () => {
    const allKeys = allSearchRowKeys();
    setSearchSelected((prev) => (prev.size === allKeys.length ? new Set() : new Set(allKeys)));
  };

  const openCrossEnvPanel = (targets) => {
    setCrossEnvTargets(targets);
    setCrossEnvType("password");
    setCrossEnvPassword("");
    setCrossEnvAttrs({ superPriv: false, createDbPriv: false, createUserPriv: false, accountLocked: false });
    setCrossEnvAccessType("readonly");
    setCrossEnvDbOptions([]);
    setCrossEnvDbGroups({});
    setCrossEnvResults([]);
  };

  const closeCrossEnvPanel = () => setCrossEnvTargets(null);

  const openBulkUpdate = () => {
    const targets = [];
    searchResults.forEach((r) =>
      (r.matches || []).forEach((m) => {
        if (searchSelected.has(rowKey(r.connectionName, m.Host))) {
          targets.push({ connectionName: r.connectionName, host: m.Host });
        }
      })
    );
    if (targets.length) openCrossEnvPanel(targets);
  };

  // Fetches the union of databases across every target env's server, so the
  // "Update access" panel can offer one checklist that applies to all of them.
  const loadCrossEnvDatabases = async (targets) => {
    setCrossEnvDbLoading(true);
    try {
      const uniqueConns = [...new Set(targets.map((t) => t.connectionName))];
      const lists = await Promise.all(
        uniqueConns.map((cn) => api.getDatabasesCrossEnv(cn).catch(() => []))
      );
      setCrossEnvDbOptions([...new Set(lists.flat())].sort());
    } finally {
      setCrossEnvDbLoading(false);
    }
  };

  const selectCrossEnvType = (type) => {
    setCrossEnvType(type);
    if (type === "access" && crossEnvDbOptions.length === 0 && !crossEnvDbLoading) {
      loadCrossEnvDatabases(crossEnvTargets);
    }
  };

  // A freshly-selected database defaults to applying to every target env (matching
  // the old uniform behavior); the user can then narrow it down per database via
  // the "Applies to" chips — e.g. grant "titanDB" only to PROD while other
  // databases still go to every environment selected above.
  const crossEnvAllTargetKeys = () => crossEnvTargets.map((t) => rowKey(t.connectionName, t.host));

  const toggleCrossEnvDb = (db) => {
    setCrossEnvDbGroups((prev) => {
      const next = { ...prev };
      if (next[db]) delete next[db];
      else next[db] = new Set(crossEnvAllTargetKeys());
      return next;
    });
  };

  const toggleCrossEnvSelectAllDbs = () => {
    setCrossEnvDbGroups((prev) => {
      if (Object.keys(prev).length === crossEnvDbOptions.length) return {};
      const next = {};
      for (const db of crossEnvDbOptions) next[db] = new Set(crossEnvAllTargetKeys());
      return next;
    });
  };

  const toggleCrossEnvEnvForDb = (db, key) => {
    setCrossEnvDbGroups((prev) => {
      const current = prev[db] || new Set(crossEnvAllTargetKeys());
      const envs = new Set(current);
      envs.has(key) ? envs.delete(key) : envs.add(key);
      return { ...prev, [db]: envs };
    });
  };

  const toggleCrossEnvEnvSelectAllForDb = (db) => {
    setCrossEnvDbGroups((prev) => {
      const current = prev[db] || new Set();
      const allKeys = crossEnvAllTargetKeys();
      const allSelected = current.size === allKeys.length;
      return { ...prev, [db]: allSelected ? new Set() : new Set(allKeys) };
    });
  };

  const crossEnvSelectedDbCount = Object.keys(crossEnvDbGroups).length;

  const applyCrossEnvUpdate = async () => {
    if (!crossEnvTargets || crossEnvTargets.length === 0) return;
    if (crossEnvType === "password" && !crossEnvPassword) {
      setCrossEnvResults([{ connectionName: "-", host: "-", success: false, message: "Password is required" }]);
      return;
    }
    // Each selected database carries its own subset of target environments
    // (a database can be scoped to fewer envs than the overall selection).
    const accessGroups = Object.entries(crossEnvDbGroups)
      .filter(([, envSet]) => envSet.size > 0)
      .map(([database, envSet]) => ({
        database,
        targets: [...envSet].map((key) => {
          const [connectionName, host] = key.split("|");
          return { connectionName, host };
        }),
      }));
    if (crossEnvType === "access" && accessGroups.length === 0) {
      setCrossEnvResults([{ connectionName: "-", host: "-", success: false, message: "Select at least one database (and at least one environment it applies to)" }]);
      return;
    }
    setCrossEnvApplying(true);
    setCrossEnvResults([]);
    try {
      const data = await api.updateUserCrossEnv({
        targets: crossEnvType === "access" ? undefined : crossEnvTargets,
        username: searchUsername.trim(),
        updateType: crossEnvType,
        password: crossEnvType === "password" ? crossEnvPassword : undefined,
        attributes: crossEnvType === "attributes" ? crossEnvAttrs : undefined,
        access: crossEnvType === "access" ? { type: crossEnvAccessType, groups: accessGroups } : undefined,
      });
      setCrossEnvResults(data.results || []);
      setSearchSelected(new Set());
      await fetchSearchResults(searchUsername.trim());
    } catch (err) {
      setCrossEnvResults([{ connectionName: "-", host: "-", success: false, message: err.message }]);
    }
    setCrossEnvApplying(false);
  };

  // ════════════════════════════════════════
  //  ADD USER ACROSS ENVIRONMENTS
  // ════════════════════════════════════════

  const handleShowCreateUserCrossEnv = (presetConnectionNames, presetUsername) => {
    setView("create-user-cross-env");
    setMsg("");
    setCreateEnvSelected(new Set(presetConnectionNames || []));
    setCreateEnvForm({
      user: presetUsername || "", host: "%", password: "",
      superPriv: false, createDbPriv: false, createUserPriv: false, accountLocked: false,
    });
    setCreateEnvResults([]);
  };

  const toggleCreateEnvSelected = (name) => {
    setCreateEnvSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const toggleCreateEnvSelectAll = () => {
    const allNames = Object.keys(connections);
    setCreateEnvSelected((prev) => (prev.size === allNames.length ? new Set() : new Set(allNames)));
  };

  const handleCreateUserCrossEnv = async () => {
    setCreateEnvResults([]);
    if (createEnvSelected.size === 0) { setError("Select at least one target environment"); return; }
    if (!createEnvForm.user.trim()) { setError("Username is required"); return; }
    setMsg("");
    setCreateEnvApplying(true);
    try {
      const data = await api.createUserCrossEnv({
        connectionNames: [...createEnvSelected],
        user: createEnvForm.user.trim(),
        host: createEnvForm.host || "%",
        password: createEnvForm.password,
        superPriv: createEnvForm.superPriv,
        createDbPriv: createEnvForm.createDbPriv,
        createUserPriv: createEnvForm.createUserPriv,
        accountLocked: createEnvForm.accountLocked,
      });
      setCreateEnvResults(data.results || []);
    } catch (err) {
      setError(err.message);
    }
    setCreateEnvApplying(false);
  };

  // ════════════════════════════════════════
  //  TABLE COLUMNS
  // ════════════════════════════════════════

  const yesNo = (val) => val === "Y" ? "Yes" : "No";

  const userColumns = [
    { key: "User",            label: "User" },
    { key: "Host",            label: "Host" },
    { key: "Super_priv",      label: "Super",      render: (r) => yesNo(r.Super_priv) },
    { key: "Create_priv",     label: "Create DB",  render: (r) => yesNo(r.Create_priv) },
    { key: "Create_user_priv",label: "Create User",render: (r) => yesNo(r.Create_user_priv) },
    { key: "account_locked",  label: "Locked",     render: (r) => yesNo(r.account_locked) },
  ];

  const roleColumns = [
    { key: "User", label: "Role" },
    { key: "Host", label: "Host" },
  ];

  // ════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════

  const filteredRows = tableData.filter((r) =>
    `${r.User}@${r.Host}`.toLowerCase().includes(tableSearch.toLowerCase())
  );

  return (
    <div className="app">

      {/* ═══ Connection Bar ═══ */}
      <div className="connection-bar">
        <div className="connection-bar-top">
          <h1>MySQL User Management</h1>
          {connected && (
            <span className="status-badge connected">
              <span className="dot green" />
              Connected to <code>{connInfo?.host}:{connInfo?.port}</code>
              <span className="conn-label">({connInfo?.name})</span>
            </span>
          )}
        </div>

        <div className="connection-controls">
          <select value={selectedConn} onChange={(e) => setSelectedConn(e.target.value)} disabled={connected}>
            <option value="">-- Select Connection --</option>
            {Object.entries(connections).map(([name, cfg]) => (
              <option key={name} value={name}>{cfg.host}</option>
            ))}
          </select>

          {!connected ? (
            <>
              <button className="btn btn-primary" onClick={handleConnect} disabled={!selectedConn || connecting}>
                {connecting ? "Connecting..." : "Connect"}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowAddForm(!showAddForm)}>
                {showAddForm ? "Cancel" : "+ Add Connection"}
              </button>
            </>
          ) : (
            <button className="btn btn-danger" onClick={handleDisconnect}>Disconnect</button>
          )}
          <button className={`btn btn-secondary ${view === "search-user" ? "btn-primary" : ""}`} onClick={handleShowSearchUser}>
            🔎 Search User in All Envs
          </button>
          <button className={`btn btn-secondary ${view === "create-user-cross-env" ? "btn-primary" : ""}`} onClick={() => handleShowCreateUserCrossEnv()}>
            ➕ Add User in All Envs
          </button>
        </div>

        {connError && <p className="error-msg" style={{ marginTop: 12 }}>{connError}</p>}

        {showAddForm && !connected && (
          <div className="add-conn-form">
            <h3>Add New Connection</h3>
            <div className="form-row">
              <input placeholder="Name (e.g. PROD)" value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} />
              <input placeholder="Host" value={addForm.host}
                onChange={(e) => setAddForm({ ...addForm, host: e.target.value })} />
              <input placeholder="Port" value={addForm.port}
                onChange={(e) => setAddForm({ ...addForm, port: e.target.value })} style={{ width: 80 }} />
              <input placeholder="User" value={addForm.user}
                onChange={(e) => setAddForm({ ...addForm, user: e.target.value })} />
              <input placeholder="Password" type="password" value={addForm.password}
                onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} />
              <button className="btn btn-primary" onClick={handleAddConnection}>Save to .env</button>
            </div>
          </div>
        )}

        <p className="hint">Connections are read from the <code>.env</code> file. Use "Add Connection" to save new ones.</p>
      </div>

      {/* ═══ Action Buttons ═══ */}
      {connected && (
        <div className="action-buttons">
          <button className={`btn btn-action ${view === "users" ? "active" : ""}`} onClick={handleViewUsers}>View Users</button>
          <button className={`btn btn-action ${view === "roles" ? "active" : ""}`} onClick={handleViewRoles}>View Roles</button>

          {(view === "users" || view === "roles") && (
            <input
              className="table-search"
              placeholder={`Search ${view}...`}
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
            />
          )}

          <div className="action-buttons-right">
            <button className={`btn btn-action ${view === "adduser" ? "active" : ""}`} onClick={handleShowAddUser}>Add User</button>
            <div className="export-dropdown">
              <button className="btn btn-export">Export to CSV</button>
              <div className="export-menu">
                <button onClick={() => handleOpenExport("roles")}>Export Roles</button>
                <button onClick={() => handleOpenExport("users")}>Export Users</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Content Area ═══ */}
      {(connected || view === "search-user" || view === "create-user-cross-env") && view && (
        <div className="content-area">

          {msg && (
            <div className={msgType === "error" ? "error-msg" : "msg"}>
              <div className="msg-body">
                <span>{msg}</span>
                {msgType === "error" && getErrorHint(msg) && (
                  <div className="error-hint">{getErrorHint(msg)}</div>
                )}
              </div>
              <button className="msg-close" onClick={() => setMsg("")}>✕</button>
            </div>
          )}

          {/* ── View Users ── */}
          {view === "users" && (
            <>
              <h2>Users ({connInfo?.name})</h2>
              <DataTable
                columns={userColumns}
                rows={filteredRows}
                actions={(row) => (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => handleOpenManage(row)}>Manage</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDrop(row)}>Drop</button>
                  </div>
                )}
              />
            </>
          )}

          {/* ── View Roles ── */}
          {view === "roles" && (
            <>
              <h2>Roles ({connInfo?.name})</h2>
              <DataTable
                columns={roleColumns}
                rows={filteredRows}
                actions={(row) => (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => handleOpenManage(row)}>Manage</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDrop(row)}>Drop</button>
                  </div>
                )}
              />
            </>
          )}

          {/* ── Manage / Edit ── */}
          {view === "edit-role" && selectedUser && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <button className="btn btn-secondary btn-sm"
                  onClick={() => setView(selectedUser.account_locked === "Y" ? "roles" : "users")}>
                  ← Back
                </button>
                <h2 style={{ margin: 0 }}>
                  {selectedUser.User}<span style={{ color: "#8b949e" }}>@{selectedUser.Host}</span>
                </h2>
              </div>

              <div className="tab-bar">
                {["attributes", "membership", "access"].map((t) => (
                  <button key={t} className={`tab-btn ${editTab === t ? "active" : ""}`} onClick={() => setEditTab(t)}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {editForm === null ? (
                <p style={{ color: "#8b949e" }}>Loading...</p>
              ) : (
                <div className="tab-content">

                  {/* Attributes */}
                  {editTab === "attributes" && (
                    <div className="edit-form">
                      <div className="form-row" style={{ marginBottom: 16 }}>
                        <input type="password" placeholder="New password (leave blank to keep)"
                          value={editForm.password}
                          onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                          style={{ minWidth: 280 }} />
                      </div>
                      <div className="toggle-row">
                        <Toggle
                          checked={editForm.superPriv}
                          onChange={(v) => {
                            if (v && !confirm(`Grant SUPER privilege to "${selectedUser.User}"@"${selectedUser.Host}"?\n\nSUPER bypasses many MySQL permission checks.`)) return;
                            setEditForm({ ...editForm, superPriv: v });
                          }}
                          label="Super privilege?"
                        />
                        <Toggle checked={editForm.createDbPriv}   onChange={(v) => setEditForm({ ...editForm, createDbPriv: v })}   label="Create databases?" />
                        <Toggle checked={editForm.createUserPriv} onChange={(v) => setEditForm({ ...editForm, createUserPriv: v })} label="Create users?" />
                        <Toggle checked={editForm.accountLocked}  onChange={(v) => setEditForm({ ...editForm, accountLocked: v })}  label="Account locked?" />
                      </div>
                      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={handleSaveEdit}>
                        Save Changes
                      </button>
                    </div>
                  )}

                  {/* Membership */}
                  {editTab === "membership" && (
                    <div className="edit-form">
                      <div className="membership-section">
                        <h3>Member of</h3>
                        <p className="membership-hint">Roles granted to "{selectedUser.User}"</p>
                        <div className="membership-list">
                          {editMemberOf.length === 0 && <span className="empty">None</span>}
                          {editMemberOf.map((r) => (
                            <div key={r} className="membership-item">
                              <span>{r}</span>
                              <button className="btn btn-danger btn-sm"
                                onClick={() => setEditMemberOf(editMemberOf.filter((x) => x !== r))}>
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="membership-add">
                          <select defaultValue="" onChange={(e) => {
                            const v = e.target.value;
                            if (v && !editMemberOf.includes(v)) setEditMemberOf([...editMemberOf, v]);
                            e.target.value = "";
                          }}>
                            <option value="" disabled>+ Add role...</option>
                            {allRoles
                              .filter((r) => r.value !== `${selectedUser.User}@${selectedUser.Host}` && !editMemberOf.includes(r.value))
                              .map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="membership-section">
                        <h3>Members</h3>
                        <p className="membership-hint">Users/roles that have been granted "{selectedUser.User}"</p>
                        <div className="membership-list">
                          {editMembers.length === 0 && <span className="empty">None</span>}
                          {editMembers.map((r) => (
                            <div key={r} className="membership-item">
                              <span>{r}</span>
                              <button className="btn btn-danger btn-sm"
                                onClick={() => setEditMembers(editMembers.filter((x) => x !== r))}>
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="membership-add">
                          <select defaultValue="" onChange={(e) => {
                            const v = e.target.value;
                            if (v && !editMembers.includes(v)) setEditMembers([...editMembers, v]);
                            e.target.value = "";
                          }}>
                            <option value="" disabled>+ Add member...</option>
                            {allRoles
                              .filter((r) => r.value !== `${selectedUser.User}@${selectedUser.Host}` && !editMembers.includes(r.value))
                              .map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                        </div>
                      </div>

                      <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={handleSaveEdit}>
                        Save Changes
                      </button>
                    </div>
                  )}

                  {/* Access */}
                  {editTab === "access" && (
                    <div className="edit-form">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                        <h3 style={{ margin: 0 }}>Database access on <code>{connInfo?.name}</code></h3>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="btn btn-action btn-sm"
                            onClick={() => handleGrantAccess("readonly", Object.keys(dbAccess))}
                            disabled={Object.keys(dbAccess).length === 0}>
                            Grant Read Only — All
                          </button>
                          <button className="btn btn-action btn-sm"
                            onClick={() => handleGrantAccess("readwrite", Object.keys(dbAccess))}
                            disabled={Object.keys(dbAccess).length === 0}>
                            Grant Read & Write — All
                          </button>
                          <button className="btn btn-danger btn-sm"
                            onClick={() => handleRevokeAccess(Object.keys(dbAccess).filter((d) => dbAccess[d] !== "none"))}
                            disabled={Object.values(dbAccess).every((a) => a === "none")}>
                            Revoke All
                          </button>
                        </div>
                      </div>

                      {Object.keys(dbAccess).length === 0 ? (
                        <p className="empty">No user databases found.</p>
                      ) : (
                        <table className="schema-access-table">
                          <thead>
                            <tr><th>Database</th><th>Access</th><th>Actions</th></tr>
                          </thead>
                          <tbody>
                            {Object.entries(dbAccess).map(([db, access]) => (
                              <tr key={db}>
                                <td><code>{db}</code></td>
                                <td>
                                  <span className={`access-badge access-${access}`}>
                                    {access === "none" ? "No Access" : access === "readonly" ? "Read Only" : "Read & Write"}
                                  </span>
                                </td>
                                <td>
                                  <div style={{ display: "flex", gap: 6 }}>
                                    <button className={`btn btn-sm btn-action ${access === "readonly" ? "active" : ""}`}
                                      onClick={() => handleGrantAccess("readonly", [db])}>Read Only</button>
                                    <button className={`btn btn-sm btn-action ${access === "readwrite" ? "active" : ""}`}
                                      onClick={() => handleGrantAccess("readwrite", [db])}>Read & Write</button>
                                    <button className="btn btn-sm btn-danger"
                                      onClick={() => handleRevokeAccess([db])}
                                      disabled={access === "none"}>Revoke</button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Add User ── */}
          {view === "adduser" && (
            <>
              <h2>Create New User</h2>
              <div className="add-user-form">
                <div className="form-row">
                  <input placeholder="Username" value={userForm.user}
                    onChange={(e) => setUserForm({ ...userForm, user: e.target.value })} />
                  <input placeholder="Host (e.g. % or localhost)" value={userForm.host}
                    onChange={(e) => setUserForm({ ...userForm, host: e.target.value })} />
                  <input placeholder="Password" type="password" value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
                </div>
                <div className="toggle-row" style={{ marginBottom: 12 }}>
                  <Toggle
                    checked={userForm.superPriv}
                    onChange={(v) => {
                      if (v && !confirm(`Grant SUPER privilege to "${userForm.user || "this user"}"?\n\nSUPER bypasses many MySQL permission checks.`)) return;
                      setUserForm({ ...userForm, superPriv: v });
                    }}
                    label="Super privilege?"
                  />
                  <Toggle checked={userForm.createDbPriv}   onChange={(v) => setUserForm({ ...userForm, createDbPriv: v })}   label="Create databases?" />
                  <Toggle checked={userForm.createUserPriv} onChange={(v) => setUserForm({ ...userForm, createUserPriv: v })} label="Create users?" />
                  <Toggle checked={userForm.accountLocked}  onChange={(v) => setUserForm({ ...userForm, accountLocked: v })}  label="Account locked?" />
                </div>

                {/* Member of */}
                <div className="membership-section" style={{ marginBottom: 16, marginTop: 20 }}>
                  <h3>Member of</h3>
                  <p className="membership-hint">Assign this user to existing roles</p>
                  <div className="membership-list">
                    {addUserMemberOf.length === 0 && <span className="empty">None selected</span>}
                    {addUserMemberOf.map((r) => (
                      <div key={r} className="membership-item">
                        <span>{r}</span>
                        <button className="btn btn-danger btn-sm"
                          onClick={() => setAddUserMemberOf(addUserMemberOf.filter((x) => x !== r))}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="membership-add">
                    <select defaultValue="" onChange={(e) => {
                      const v = e.target.value;
                      if (v && !addUserMemberOf.includes(v)) setAddUserMemberOf([...addUserMemberOf, v]);
                      e.target.value = "";
                    }}>
                      <option value="" disabled>+ Add role...</option>
                      {allRoles
                        .filter((r) => !addUserMemberOf.includes(r.value))
                        .map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                </div>

                <button className="btn btn-primary" onClick={handleCreateUser}>Create User</button>
              </div>
            </>
          )}

          {/* ── Search User Across Environments ── */}
          {view === "search-user" && (
            <>
              <h2>Search User Across Environments</h2>
              <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
                Searches every connection saved in <code>.env</code>, independent of whichever connection is currently active.
              </p>

              <div className="form-row">
                <input
                  placeholder="Exact username..."
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runSearchUser(); }}
                  style={{ minWidth: 280 }}
                />
                <button className="btn btn-primary" onClick={runSearchUser} disabled={searching}>
                  {searching ? "Searching..." : "🔎 Search"}
                </button>
              </div>

              {searchStatusMsg && (
                <div className={searchStatusType === "error" ? "error-msg" : "msg"}>
                  <div className="msg-body">{searchStatusMsg}</div>
                </div>
              )}

              {searchResults.length > 0 && (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, marginBottom: 8 }}>
                    <h3 style={{ margin: 0 }}>Results</h3>
                    <button className="btn btn-primary btn-sm" onClick={openBulkUpdate} disabled={searchSelected.size === 0}>
                      ✏️ Update Selected ({searchSelected.size})
                    </button>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <input
                            type="checkbox"
                            checked={allSearchRowKeys().length > 0 && searchSelected.size === allSearchRowKeys().length}
                            onChange={toggleSearchSelectAll}
                          />
                        </th>
                        <th>Environment</th>
                        <th>Server</th>
                        <th>Matched Host</th>
                        <th>Super</th>
                        <th>Create DB</th>
                        <th>Locked</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchResults.map((r) => {
                        if (r.error) {
                          return (
                            <tr key={r.connectionName}>
                              <td></td>
                              <td>{r.connectionName}</td>
                              <td>{r.host}</td>
                              <td colSpan={5} style={{ color: "#f85149" }}>⚠️ Could not connect: {r.error}</td>
                            </tr>
                          );
                        }
                        if (!r.matches || r.matches.length === 0) {
                          return (
                            <tr key={r.connectionName}>
                              <td></td>
                              <td>{r.connectionName}</td>
                              <td>{r.host}</td>
                              <td colSpan={4} className="empty">Not found</td>
                              <td>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleShowCreateUserCrossEnv([r.connectionName], searchUsername.trim())}
                                >
                                  ➕ Add User
                                </button>
                              </td>
                            </tr>
                          );
                        }
                        return r.matches.map((m) => {
                          const key = rowKey(r.connectionName, m.Host);
                          return (
                            <tr key={key}>
                              <td>
                                <input type="checkbox" checked={searchSelected.has(key)} onChange={() => toggleSearchRow(r.connectionName, m.Host)} />
                              </td>
                              <td>{r.connectionName}</td>
                              <td>{r.host}</td>
                              <td><code>{m.Host}</code></td>
                              <td>{yesNo(m.Super_priv)}</td>
                              <td>{yesNo(m.Create_priv)}</td>
                              <td>{yesNo(m.account_locked)}</td>
                              <td>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => openCrossEnvPanel([{ connectionName: r.connectionName, host: m.Host }])}
                                >
                                  Update
                                </button>
                              </td>
                            </tr>
                          );
                        });
                      })}
                    </tbody>
                  </table>
                </>
              )}

              {crossEnvTargets && (
                <div className="cross-env-panel">
                  <h3>Update "{searchUsername.trim()}"</h3>
                  <p className="membership-hint">Target environment(s):</p>
                  <div className="target-chip-row">
                    {crossEnvTargets.map((t) => (
                      <span key={rowKey(t.connectionName, t.host)} className="target-chip">
                        {t.connectionName} <code>{t.host}</code>
                      </span>
                    ))}
                  </div>

                  <div className="toggle-row" style={{ marginTop: 12 }}>
                    <label className="toggle-label">
                      <input type="radio" name="crossEnvType" checked={crossEnvType === "password"} onChange={() => selectCrossEnvType("password")} />
                      <span>Update password</span>
                    </label>
                    <label className="toggle-label">
                      <input type="radio" name="crossEnvType" checked={crossEnvType === "attributes"} onChange={() => selectCrossEnvType("attributes")} />
                      <span>Update attributes</span>
                    </label>
                    <label className="toggle-label">
                      <input type="radio" name="crossEnvType" checked={crossEnvType === "access"} onChange={() => selectCrossEnvType("access")} />
                      <span>Update access</span>
                    </label>
                  </div>

                  {crossEnvType === "password" && (
                    <div className="form-row">
                      <input
                        type="password"
                        placeholder="New password"
                        value={crossEnvPassword}
                        onChange={(e) => setCrossEnvPassword(e.target.value)}
                        style={{ minWidth: 280 }}
                      />
                    </div>
                  )}

                  {crossEnvType === "attributes" && (
                    <div className="toggle-row">
                      <Toggle checked={crossEnvAttrs.superPriv} onChange={(v) => setCrossEnvAttrs({ ...crossEnvAttrs, superPriv: v })} label="Super privilege?" />
                      <Toggle checked={crossEnvAttrs.createDbPriv} onChange={(v) => setCrossEnvAttrs({ ...crossEnvAttrs, createDbPriv: v })} label="Create databases?" />
                      <Toggle checked={crossEnvAttrs.createUserPriv} onChange={(v) => setCrossEnvAttrs({ ...crossEnvAttrs, createUserPriv: v })} label="Create users?" />
                      <Toggle checked={crossEnvAttrs.accountLocked} onChange={(v) => setCrossEnvAttrs({ ...crossEnvAttrs, accountLocked: v })} label="Account locked?" />
                    </div>
                  )}

                  {crossEnvType === "access" && (
                    <div>
                      <div className="toggle-row" style={{ marginBottom: 10 }}>
                        <label className="toggle-label">
                          <input type="radio" name="crossEnvAccessType" checked={crossEnvAccessType === "readonly"} onChange={() => setCrossEnvAccessType("readonly")} />
                          <span>Read Only</span>
                        </label>
                        <label className="toggle-label">
                          <input type="radio" name="crossEnvAccessType" checked={crossEnvAccessType === "readwrite"} onChange={() => setCrossEnvAccessType("readwrite")} />
                          <span>Read & Write</span>
                        </label>
                        <label className="toggle-label">
                          <input type="radio" name="crossEnvAccessType" checked={crossEnvAccessType === "revoke"} onChange={() => setCrossEnvAccessType("revoke")} />
                          <span>Revoke</span>
                        </label>
                      </div>

                      <p className="membership-hint" style={{ marginBottom: 4 }}>
                        Each database defaults to applying to every target environment above — narrow the
                        "Applies to" chips if a database should only go to some of them (e.g. grant <code>titanDB</code> only to PROD).
                        {crossEnvSelectedDbCount > 0 && <strong style={{ color: "#98c379" }}> — {crossEnvSelectedDbCount} database(s) selected</strong>}
                      </p>

                      {crossEnvDbLoading ? (
                        <p className="hint">Loading databases from target environment(s)...</p>
                      ) : crossEnvDbOptions.length === 0 ? (
                        <p className="empty">No databases found across the target environment(s).</p>
                      ) : (
                        <>
                          <button type="button" className="btn btn-secondary btn-sm" style={{ marginBottom: 8 }}
                            onClick={toggleCrossEnvSelectAllDbs}>
                            {crossEnvSelectedDbCount === crossEnvDbOptions.length ? "Deselect All" : "Select All"}
                          </button>
                          <div className="db-tree">
                            {crossEnvDbOptions.map((db) => {
                              const group = crossEnvDbGroups[db];
                              const selected = !!group;
                              const allKeys = crossEnvAllTargetKeys();
                              const scoped = selected && group.size < allKeys.length;
                              return (
                                <div key={db} className="db-tree-item">
                                  <label className="db-tree-row">
                                    <input type="checkbox" checked={selected} onChange={() => toggleCrossEnvDb(db)} />
                                    <code>{db}</code>
                                    {scoped && (
                                      <span className="access-badge access-readonly" style={{ fontSize: 11 }}>
                                        {group.size} of {allKeys.length} env(s)
                                      </span>
                                    )}
                                  </label>
                                  {selected && (
                                    <div className="db-tree-body">
                                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                        <span style={{ fontSize: 11, color: "#8b949e" }}>Applies to:</span>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleCrossEnvEnvSelectAllForDb(db)}>
                                          {group.size === allKeys.length ? "Deselect All" : "Select All"}
                                        </button>
                                      </div>
                                      <div className="target-chip-row">
                                        {crossEnvTargets.map((t) => {
                                          const key = rowKey(t.connectionName, t.host);
                                          return (
                                            <label key={key} className="toggle-label target-chip">
                                              <input type="checkbox" checked={group.has(key)} onChange={() => toggleCrossEnvEnvForDb(db, key)} />
                                              <span>{t.connectionName} <code>{t.host}</code></span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                      {group.size === 0 && (
                                        <p style={{ color: "#e5c07b", fontSize: 11, margin: "6px 0 0" }}>
                                          ⚠ No environments selected — <code>{db}</code> will be skipped entirely.
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button className="btn btn-primary" onClick={applyCrossEnvUpdate} disabled={crossEnvApplying}>
                      {crossEnvApplying ? "Applying..." : `🚀 Apply to ${crossEnvTargets.length} Environment(s)`}
                    </button>
                    <button className="btn btn-secondary" onClick={closeCrossEnvPanel}>Cancel</button>
                  </div>

                  {crossEnvResults.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      {crossEnvResults.map((r, i) => (
                        <div key={i} className={r.success ? "msg" : "error-msg"} style={{ marginBottom: 6 }}>
                          <div className="msg-body">
                            {r.success ? "✅" : "❌"} <strong>{r.connectionName}</strong> (<code>{r.host}</code>) — {r.message}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Add User Across Environments ── */}
          {view === "create-user-cross-env" && (
            <>
              <h2>Add User Across Environments</h2>
              <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
                Creates the same user independently in each selected environment from <code>.env</code>.
              </p>

              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <h3 style={{ margin: 0 }}>Target Environment(s)</h3>
                  <button className="btn btn-secondary btn-sm" onClick={toggleCreateEnvSelectAll}>
                    {createEnvSelected.size === Object.keys(connections).length ? "Deselect All" : "Select All"}
                  </button>
                </div>
                <div className="target-chip-row">
                  {Object.keys(connections).length === 0 && <span className="empty">No connections configured.</span>}
                  {Object.keys(connections).map((name) => (
                    <label key={name} className="toggle-label target-chip">
                      <input type="checkbox" checked={createEnvSelected.has(name)} onChange={() => toggleCreateEnvSelected(name)} />
                      <span>{name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="add-user-form">
                <div className="form-row">
                  <input placeholder="Username" value={createEnvForm.user}
                    onChange={(e) => setCreateEnvForm({ ...createEnvForm, user: e.target.value })} />
                  <input placeholder="Host (e.g. % or localhost)" value={createEnvForm.host}
                    onChange={(e) => setCreateEnvForm({ ...createEnvForm, host: e.target.value })} />
                  <input placeholder="Password" type="password" value={createEnvForm.password}
                    onChange={(e) => setCreateEnvForm({ ...createEnvForm, password: e.target.value })} />
                </div>
                <div className="toggle-row" style={{ marginBottom: 12 }}>
                  <Toggle
                    checked={createEnvForm.superPriv}
                    onChange={(v) => {
                      if (v && !confirm(`Grant SUPER privilege to "${createEnvForm.user || "this user"}"?\n\nSUPER bypasses many MySQL permission checks.`)) return;
                      setCreateEnvForm({ ...createEnvForm, superPriv: v });
                    }}
                    label="Super privilege?"
                  />
                  <Toggle checked={createEnvForm.createDbPriv}   onChange={(v) => setCreateEnvForm({ ...createEnvForm, createDbPriv: v })}   label="Create databases?" />
                  <Toggle checked={createEnvForm.createUserPriv} onChange={(v) => setCreateEnvForm({ ...createEnvForm, createUserPriv: v })} label="Create users?" />
                  <Toggle checked={createEnvForm.accountLocked}  onChange={(v) => setCreateEnvForm({ ...createEnvForm, accountLocked: v })}  label="Account locked?" />
                </div>

                <button className="btn btn-primary" onClick={handleCreateUserCrossEnv} disabled={createEnvApplying}>
                  {createEnvApplying ? "Creating..." : `🚀 Create in ${createEnvSelected.size} Environment(s)`}
                </button>
              </div>

              {createEnvResults.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  {createEnvResults.map((r, i) => (
                    <div key={i} className={r.success ? "msg" : "error-msg"} style={{ marginBottom: 6 }}>
                      <div className="msg-body">{r.success ? "✅" : "❌"} <strong>{r.connectionName}</strong> — {r.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Export Selection ── */}
          {view === "export-select" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <h2 style={{ margin: 0 }}>Select {exportType === "users" ? "Users" : "Roles"} to Export</h2>
                <span style={{ color: "#8b949e", fontSize: 13 }}>{exportSelected.size} of {exportList.length} selected</span>
              </div>
              <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
                <button className="btn btn-warning btn-sm"
                  onClick={() => exportSelected.size === exportList.length
                    ? setExportSelected(new Set())
                    : setExportSelected(new Set(exportList.map((r) => `${r.User}@${r.Host}`)))}>
                  {exportSelected.size === exportList.length ? "Deselect All" : "Select All"}
                </button>
                <button className="btn btn-primary" onClick={handleDownloadExport} disabled={exportSelected.size === 0}>
                  Download CSV ({exportSelected.size})
                </button>
                <button className={`btn ${exportSelected.size > 0 ? "btn-danger" : "btn-danger-light"}`} onClick={() => setView(null)}>
                  Cancel
                </button>
              </div>
              <table>
                <thead>
                  <tr><th style={{ width: 36 }}></th><th>User</th><th>Host</th><th>Super</th><th>Create DB</th><th>Locked</th></tr>
                </thead>
                <tbody>
                  {exportList.map((row) => {
                    const id = `${row.User}@${row.Host}`;
                    return (
                      <tr key={id} onClick={() => toggleExportItem(id)}
                        style={{ cursor: "pointer", background: exportSelected.has(id) ? "rgba(97,175,239,0.08)" : "" }}>
                        <td><input type="checkbox" checked={exportSelected.has(id)}
                          onChange={() => toggleExportItem(id)} onClick={(e) => e.stopPropagation()} /></td>
                        <td>{row.User}</td>
                        <td>{row.Host}</td>
                        <td>{yesNo(row.Super_priv)}</td>
                        <td>{yesNo(row.Create_priv)}</td>
                        <td>{yesNo(row.account_locked)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

        </div>
      )}
    </div>
  );
}
