/*
  Central Trigger Auth Worker (Cloudflare + D1)

  Purpose:
  - User activation with per-user keys
  - Separate admin keys for admin operations
  - Token issue/refresh for desktop clients

  Required env:
  - DB (D1 binding)
  - TRIGGER_WS_URL (optional, returned to client)
*/

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const ADMIN_ACCESS_TTL_SECONDS = 30 * 60;
const ADMIN_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      await ensureSchema(env);

      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/v1/activate" && request.method === "POST") {
        const body = await readJson(request);
        return json(await activateUser(env, body), 200, cors);
      }

      if (path === "/v1/token/refresh" && request.method === "POST") {
        const body = await readJson(request);
        return json(await refreshUserToken(env, body), 200, cors);
      }

      if (path === "/v1/admin/login" && request.method === "POST") {
        const body = await readJson(request);
        return json(await adminLogin(env, body), 200, cors);
      }

      if (path === "/v1/admin/bootstrap" && request.method === "POST") {
        const body = await readJson(request);
        return json(await bootstrapFirstAdminKey(env, request, body), 200, cors);
      }

      if (path === "/v1/admin/keys" && request.method === "GET") {
        const admin = await requireAdmin(env, request);
        return json(await listKeys(env, admin), 200, cors);
      }

      if (path === "/v1/admin/keys" && request.method === "POST") {
        const admin = await requireAdmin(env, request);
        const body = await readJson(request);
        return json(await createKey(env, admin, body), 200, cors);
      }

      if (path.startsWith("/v1/admin/keys/") && path.endsWith("/devices") && request.method === "GET") {
        const admin = await requireAdmin(env, request, { conceal: true });
        const keyId = path.split("/")[4];
        return json(await listKeyDevices(env, admin, keyId), 200, cors);
      }

      if (path.startsWith("/v1/admin/keys/") && path.endsWith("/transfer-device") && request.method === "POST") {
        const admin = await requireAdmin(env, request, { conceal: true });
        const keyId = path.split("/")[4];
        const body = await readJson(request);
        return json(await transferDevice(env, admin, keyId, body), 200, cors);
      }

      if (path.startsWith("/v1/admin/keys/") && path.endsWith("/revoke") && request.method === "POST") {
        const admin = await requireAdmin(env, request);
        const keyId = path.split("/")[4];
        return json(await revokeKey(env, admin, keyId), 200, cors);
      }

      return json({ error: "Not found" }, 404, cors);
    } catch (error) {
      const status = error?.status || 500;
      return json({ error: error?.message || "Internal error" }, status, cors);
    }
  },
};

async function activateUser(env, body) {
  const key = String(body?.key || "").trim();
  const deviceId = String(body?.device_id || "").trim();
  const appVersion = String(body?.app_version || "").trim() || null;

  if (!key || !deviceId) throw httpError(400, "Missing key or device_id");

  const keyHash = await sha256Hex(key);
  const row = await env.DB.prepare(
    `SELECT * FROM activation_keys WHERE key_hash = ? AND status = 'active'`
  ).bind(keyHash).first();

  if (!row) throw httpError(403, "Invalid or revoked key");
  if (row.key_type !== "user") throw httpError(403, "Admin keys cannot activate clients");
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) throw httpError(403, "Key expired");

  const maxDevices = Number(row.max_devices || 1);
  const deviceRows = await env.DB.prepare(
    `SELECT DISTINCT device_id FROM activations WHERE key_id = ? AND revoked_at IS NULL`
  ).bind(row.id).all();

  const activeDevices = (deviceRows?.results || []).map((r) => r.device_id);
  const isExistingDevice = activeDevices.includes(deviceId);
  if (!isExistingDevice && activeDevices.length >= maxDevices) {
    throw httpError(403, "Device limit reached for this key");
  }

  const nowIso = new Date().toISOString();
  const activationId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO activations (id, key_id, device_id, app_version, activated_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(key_id, device_id) DO UPDATE SET
       app_version = excluded.app_version,
       last_seen_at = excluded.last_seen_at,
       revoked_at = NULL`
  ).bind(activationId, row.id, deviceId, appVersion, nowIso, nowIso).run();

  await env.DB.prepare(
    `UPDATE activation_keys SET last_used_at = ? WHERE id = ?`
  ).bind(nowIso, row.id).run();

  const session = await issueSession(env, {
    role: "user",
    keyId: row.id,
    deviceId,
    accessTtl: ACCESS_TTL_SECONDS,
    refreshTtl: REFRESH_TTL_SECONDS,
  });

  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_in: ACCESS_TTL_SECONDS,
    user_id: row.owner_ref || row.id,
    key_id: row.id,
    ws_url: env.TRIGGER_WS_URL || "",
  };
}

async function refreshUserToken(env, body) {
  const refreshToken = String(body?.refresh_token || "").trim();
  if (!refreshToken) throw httpError(400, "Missing refresh_token");

  const refreshed = await rotateSession(env, refreshToken, {
    role: "user",
    accessTtl: ACCESS_TTL_SECONDS,
    refreshTtl: REFRESH_TTL_SECONDS,
  });

  return {
    access_token: refreshed.accessToken,
    refresh_token: refreshed.refreshToken,
    expires_in: ACCESS_TTL_SECONDS,
  };
}

async function adminLogin(env, body) {
  const key = String(body?.key || "").trim();
  if (!key) throw httpError(400, "Missing admin key");

  const keyHash = await sha256Hex(key);
  const row = await env.DB.prepare(
    `SELECT * FROM activation_keys WHERE key_hash = ? AND status = 'active'`
  ).bind(keyHash).first();

  if (!row || row.key_type !== "admin") throw httpError(403, "Invalid admin key");
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) throw httpError(403, "Admin key expired");

  const session = await issueSession(env, {
    role: "admin",
    keyId: row.id,
    deviceId: "admin-console",
    accessTtl: ADMIN_ACCESS_TTL_SECONDS,
    refreshTtl: ADMIN_REFRESH_TTL_SECONDS,
  });

  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_in: ADMIN_ACCESS_TTL_SECONDS,
    role: "admin",
  };
}

async function bootstrapFirstAdminKey(env, request, body) {
  const bootstrapSecret = String(env.BOOTSTRAP_ADMIN_SECRET || "").trim();
  if (!bootstrapSecret) throw httpError(500, "BOOTSTRAP_ADMIN_SECRET is not configured");

  const authValue = parseBearer(request.headers.get("Authorization"));
  if (!authValue || authValue !== bootstrapSecret) {
    throw httpError(401, "Unauthorized bootstrap secret");
  }

  const existingAdmin = await env.DB.prepare(
    `SELECT id FROM activation_keys WHERE key_type = 'admin' AND status = 'active' LIMIT 1`
  ).first();

  const forceRotate = !!body?.force_rotate;

  if (existingAdmin && !forceRotate) {
    throw httpError(409, "Active admin key already exists; use /v1/admin/keys instead or pass force_rotate=true");
  }

  if (existingAdmin && forceRotate) {
    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE activation_keys SET status = 'revoked', revoked_at = ?, revoked_by = 'bootstrap' WHERE key_type = 'admin' AND status = 'active'`
    ).bind(nowIso).run();

    await env.DB.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE role = 'admin' AND revoked_at IS NULL`
    ).bind(nowIso).run();
  }

  const label = body?.label ? String(body.label).trim() : "bootstrap-admin";
  const ownerRef = body?.owner_ref ? String(body.owner_ref).trim() : "root";
  const maxDevices = 1;

  const plaintext = generateKeyString("admin");
  const keyHash = await sha256Hex(plaintext);
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO activation_keys
      (id, key_hash, key_type, owner_ref, label, status, max_devices, created_at, expires_at, last_used_at, created_by)
     VALUES (?, ?, 'admin', ?, ?, 'active', ?, ?, NULL, NULL, 'bootstrap')`
  ).bind(id, keyHash, ownerRef, label, maxDevices, nowIso).run();

  return {
    ok: true,
    id,
    key: plaintext,
    key_type: "admin",
    note: "Store this once; plaintext key is not recoverable later.",
  };
}

async function listKeys(env) {
  const rows = await env.DB.prepare(
    `SELECT id, key_type, owner_ref, label, status, max_devices, created_at, expires_at, last_used_at
     FROM activation_keys ORDER BY created_at DESC`
  ).all();
  return { keys: rows?.results || [] };
}

async function createKey(env, admin, body) {
  const keyType = String(body?.key_type || "user").trim();
  if (!["user", "admin"].includes(keyType)) throw httpError(400, "Invalid key_type");

  const ownerRef = body?.owner_ref ? String(body.owner_ref).trim() : null;
  const label = body?.label ? String(body.label).trim() : null;
  const maxDevices = Math.max(1, Number(body?.max_devices || 1));
  const expiresInDays = body?.expires_in_days == null ? null : Number(body.expires_in_days);

  const plaintext = generateKeyString(keyType);
  const keyHash = await sha256Hex(plaintext);
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const expiresAt = Number.isFinite(expiresInDays)
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  await env.DB.prepare(
    `INSERT INTO activation_keys
      (id, key_hash, key_type, owner_ref, label, status, max_devices, created_at, expires_at, last_used_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, ?)`
  ).bind(id, keyHash, keyType, ownerRef, label, maxDevices, nowIso, expiresAt, admin.keyId).run();

  return {
    id,
    key: plaintext,
    key_type: keyType,
    max_devices: maxDevices,
    expires_at: expiresAt,
  };
}

async function revokeKey(env, admin, keyId) {
  if (!keyId) throw httpError(400, "Missing key id");

  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE activation_keys SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ?`
  ).bind(nowIso, admin.keyId, keyId).run();

  await env.DB.prepare(
    `UPDATE activations SET revoked_at = ? WHERE key_id = ? AND revoked_at IS NULL`
  ).bind(nowIso, keyId).run();

  await env.DB.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE key_id = ? AND revoked_at IS NULL`
  ).bind(nowIso, keyId).run();

  return { ok: true };
}

async function transferDevice(env, admin, keyId, body) {
  if (!keyId) throw httpError(400, "Missing key id");

  const toDeviceId = String(body?.to_device_id || "").trim();
  let fromDeviceId = String(body?.from_device_id || "").trim();
  const appVersion = String(body?.app_version || "").trim() || "transfer";

  if (!toDeviceId) throw httpError(400, "Missing to_device_id");

  const keyRow = await env.DB.prepare(
    `SELECT * FROM activation_keys WHERE id = ? AND status = 'active'`
  ).bind(keyId).first();

  if (!keyRow) throw httpError(404, "Key not found or inactive");
  if (keyRow.key_type !== "user") throw httpError(400, "Only user keys support device transfer");
  if (keyRow.expires_at && new Date(keyRow.expires_at).getTime() < Date.now()) throw httpError(403, "Key expired");

  const maxDevices = Math.max(1, Number(keyRow.max_devices || 1));
  const deviceRows = await env.DB.prepare(
    `SELECT DISTINCT device_id FROM activations WHERE key_id = ? AND revoked_at IS NULL`
  ).bind(keyId).all();
  const activeDevices = (deviceRows?.results || []).map((r) => r.device_id);
  const isTargetActive = activeDevices.includes(toDeviceId);

  if (!fromDeviceId) {
    if (isTargetActive) {
      fromDeviceId = "";
    } else if (activeDevices.length < maxDevices) {
      fromDeviceId = "";
    } else if (maxDevices === 1 && activeDevices.length === 1) {
      fromDeviceId = activeDevices[0];
    } else {
      throw httpError(400, "from_device_id is required when key is at device limit");
    }
  }

  if (fromDeviceId && !activeDevices.includes(fromDeviceId)) {
    throw httpError(404, "from_device_id is not currently active for this key");
  }

  const nowIso = new Date().toISOString();

  if (fromDeviceId && fromDeviceId !== toDeviceId) {
    await env.DB.prepare(
      `UPDATE activations SET revoked_at = ? WHERE key_id = ? AND device_id = ? AND revoked_at IS NULL`
    ).bind(nowIso, keyId, fromDeviceId).run();

    await env.DB.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE key_id = ? AND device_id = ? AND revoked_at IS NULL`
    ).bind(nowIso, keyId, fromDeviceId).run();
  }

  const activationId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO activations (id, key_id, device_id, app_version, activated_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(key_id, device_id) DO UPDATE SET
       app_version = excluded.app_version,
       last_seen_at = excluded.last_seen_at,
       revoked_at = NULL`
  ).bind(activationId, keyId, toDeviceId, appVersion, nowIso, nowIso).run();

  await env.DB.prepare(
    `UPDATE activation_keys SET last_used_at = ? WHERE id = ?`
  ).bind(nowIso, keyId).run();

  const activeAfterRows = await env.DB.prepare(
    `SELECT DISTINCT device_id FROM activations WHERE key_id = ? AND revoked_at IS NULL ORDER BY device_id ASC`
  ).bind(keyId).all();
  const activeDevicesAfter = (activeAfterRows?.results || []).map((r) => r.device_id);

  return {
    ok: true,
    key_id: keyId,
    transferred_from: fromDeviceId || null,
    transferred_to: toDeviceId,
    active_devices_after: activeDevicesAfter,
    revoked_by: admin.keyId,
  };
}

async function listKeyDevices(env, _admin, keyId) {
  if (!keyId) throw httpError(400, "Missing key id");

  const keyRow = await env.DB.prepare(
    `SELECT id, key_type, owner_ref, label, status, max_devices FROM activation_keys WHERE id = ?`
  ).bind(keyId).first();

  if (!keyRow) throw httpError(404, "Key not found");
  if (keyRow.key_type !== "user") throw httpError(400, "Only user keys have client device bindings");

  const rows = await env.DB.prepare(
    `SELECT device_id, app_version, activated_at, last_seen_at, revoked_at
     FROM activations
     WHERE key_id = ?
     ORDER BY CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END, last_seen_at DESC`
  ).bind(keyId).all();

  const devices = (rows?.results || []).map((r) => ({
    device_id: r.device_id,
    app_version: r.app_version,
    activated_at: r.activated_at,
    last_seen_at: r.last_seen_at,
    revoked_at: r.revoked_at,
    active: r.revoked_at == null,
  }));

  return {
    key: {
      id: keyRow.id,
      owner_ref: keyRow.owner_ref,
      label: keyRow.label,
      status: keyRow.status,
      max_devices: keyRow.max_devices,
    },
    devices,
  };
}

async function requireAdmin(env, request, opts = {}) {
  const conceal = !!opts.conceal;
  const token = parseBearer(request.headers.get("Authorization"));
  if (!token) {
    throw conceal ? httpError(404, "Not found") : httpError(401, "Missing admin token");
  }

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT * FROM sessions WHERE access_token_hash = ? AND role = 'admin' AND revoked_at IS NULL`
  ).bind(tokenHash).first();

  if (!row) throw conceal ? httpError(404, "Not found") : httpError(401, "Invalid admin token");
  if (new Date(row.access_expires_at).getTime() < Date.now()) {
    throw conceal ? httpError(404, "Not found") : httpError(401, "Admin token expired");
  }

  const keyRow = await env.DB.prepare(
    `SELECT id FROM activation_keys WHERE id = ? AND key_type = 'admin' AND status = 'active'`
  ).bind(row.key_id).first();
  if (!keyRow) throw conceal ? httpError(404, "Not found") : httpError(401, "Invalid admin token");

  return { keyId: row.key_id, sessionId: row.id };
}

async function issueSession(env, opts) {
  const now = Date.now();
  const accessToken = randomToken(32);
  const refreshToken = randomToken(48);
  const accessTokenHash = await sha256Hex(accessToken);
  const refreshTokenHash = await sha256Hex(refreshToken);
  const id = crypto.randomUUID();

  const accessExpiresAt = new Date(now + opts.accessTtl * 1000).toISOString();
  const refreshExpiresAt = new Date(now + opts.refreshTtl * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions
      (id, key_id, role, device_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at, created_at, updated_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).bind(
    id,
    opts.keyId,
    opts.role,
    opts.deviceId,
    accessTokenHash,
    refreshTokenHash,
    accessExpiresAt,
    refreshExpiresAt,
    nowIso,
    nowIso
  ).run();

  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}

async function rotateSession(env, refreshToken, opts) {
  const refreshHash = await sha256Hex(refreshToken);
  const row = await env.DB.prepare(
    `SELECT * FROM sessions WHERE refresh_token_hash = ? AND role = ? AND revoked_at IS NULL`
  ).bind(refreshHash, opts.role).first();

  if (!row) throw httpError(401, "Invalid refresh token");
  if (new Date(row.refresh_expires_at).getTime() < Date.now()) throw httpError(401, "Refresh token expired");

  const accessToken = randomToken(32);
  const newRefreshToken = randomToken(48);
  const accessHash = await sha256Hex(accessToken);
  const newRefreshHash = await sha256Hex(newRefreshToken);
  const now = Date.now();

  const accessExpiresAt = new Date(now + opts.accessTtl * 1000).toISOString();
  const refreshExpiresAt = new Date(now + opts.refreshTtl * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  await env.DB.prepare(
    `UPDATE sessions
     SET access_token_hash = ?, refresh_token_hash = ?, access_expires_at = ?, refresh_expires_at = ?, updated_at = ?
     WHERE id = ?`
  ).bind(accessHash, newRefreshHash, accessExpiresAt, refreshExpiresAt, nowIso, row.id).run();

  return { accessToken, refreshToken: newRefreshToken };
}

async function ensureSchema(env) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS activation_keys (id TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, key_type TEXT NOT NULL, owner_ref TEXT, label TEXT, status TEXT NOT NULL DEFAULT 'active', max_devices INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, expires_at TEXT, last_used_at TEXT, created_by TEXT, revoked_at TEXT, revoked_by TEXT)`,
    `CREATE TABLE IF NOT EXISTS activations (id TEXT PRIMARY KEY, key_id TEXT NOT NULL, device_id TEXT NOT NULL, app_version TEXT, activated_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT, UNIQUE(key_id, device_id))`,
    `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, key_id TEXT NOT NULL, role TEXT NOT NULL, device_id TEXT NOT NULL, access_token_hash TEXT NOT NULL, refresh_token_hash TEXT NOT NULL, access_expires_at TEXT NOT NULL, refresh_expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revoked_at TEXT)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_access_hash ON sessions(access_token_hash)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_hash ON sessions(refresh_token_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_activations_key_device ON activations(key_id, device_id)`,
  ];

  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
}

function randomToken(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generateKeyString(type) {
  const prefix = type === "admin" ? "KNULL-ADM" : "KNULL-USR";
  return `${prefix}-${randomToken(18).toUpperCase()}`;
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "Invalid JSON body");
  }
}

function parseBearer(header) {
  const value = String(header || "");
  if (!value.toLowerCase().startsWith("bearer ")) return "";
  return value.slice(7).trim();
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}
